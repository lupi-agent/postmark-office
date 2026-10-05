#!/usr/bin/env node
// stamp-mint-run.mjs — THE MINT DECIDES FROM THE STORE (POS-341, Q4).
//
// Ruled by Darko, 2026-10-04. The crossing's mint pass was `node
// tools/stamp-mint.mjs --append`, run in the town clone. It decided every
// correspondence mint, friendship mint, transfer and void from git files: the
// mail ledger, the pins file, the ADDRESS cards and the stamp ledger itself.
// That is how nine households minted as two (68 extra stamps, 09-14 → 10-03):
// the keys came from files nothing compared. This runner makes the same
// decision from the store:
//
//   the ledger      stamp_lines (064)
//   the key base    household_pins + town_rooms (065), src/mint-inputs.mjs §
//                   keyBaseOf, held to the town's householdKeys by the parity
//                   gate (world2/tools/stamp-mint-parity.mjs)
//   the deliveries  town_mail_lines (065), read by the town's own parseDeliveries
//
// THE LAW STAYS THE TOWN'S. The runner imports the town engine and calls the
// functions --append calls, in --append's order: deriveMints,
// deriveFriendshipMints, combineDerived, walkLedger (a divergent ledger appends
// nothing), deriveTransfers, interleaveByDelivery. Then it signs the owed lines
// onto the export with the engine's own appendSigned, records them in
// stamp_lines and commits the export, all in ONE store transaction (src/stamp-
// lines.mjs § the pen's transaction). Its output is --append's, line for line:
// test/stamp-mint-run.test.mjs holds the two byte-equal on a fixture town.
//
//   node world2/tools/stamp-mint-run.mjs --append --key <ed25519 pem> [--clone <town clone>] [--message <commit message>]
//
// The caller holds the town lock (the ferry's flock, the keep tick's), as for
// --append. The store must hold its inputs: 064 and 065 applied, one town-index
// ingest run and the chain recorded (stamp-lines.mjs --sync). An empty input is
// a refusal by name, never a mint from nothing. Exit 0 appended or up to date,
// 1 refused.

import { existsSync, realpathSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { mintInputsVia, keyBaseOf, sealedDatesOf, deliveriesOf } from "../../src/mint-inputs.mjs";
import { engineOf, stampLinesVia, syncStampLinesVia } from "../../src/stamp-lines.mjs";
import { penCommit } from "../../src/write.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * What --append would append, decided from the store's inputs: `{ problems,
 * lines, mints, moved, voided, recorded }`. `lines` are canonicals, unsigned.
 * Pure over its arguments, so a test can hold it to the town CLI.
 */
export function owedFromStore(engine, { entries, mailLines, pins, rooms }) {
  const deliveries = deliveriesOf(engine, mailLines);
  const households = keyBaseOf({ pins, rooms, sealed: sealedDatesOf(engine, entries) });
  const { laws, revisions } = engine.parseLaws(entries);
  const corr = engine.deriveMints(deliveries, households, { laws, revisions });
  const friend = engine.deriveFriendshipMints(deliveries, households, { laws, revisions });
  const mints = engine.combineDerived(deliveries, corr, friend);
  const transfers = engine.deriveTransfers(deliveries, households, { laws, revisions }, entries);
  const genesisDate = deliveries[0]?.date ?? "2026-06-12";
  const recorded = entries.map((e) => e.canonical);
  if (entries.length > 0 && recorded[0] !== engine.rulesLine(genesisDate))
    return { problems: ["the ledger does not open with the v1 rules marker"], lines: [] };
  const body = entries.length === 0 ? [] : recorded.slice(1);
  const { problems, owed } = engine.walkLedger(body, mints);
  if (problems.length) return { problems, lines: [] };
  const settled = new Set();
  for (const e of entries) { const c = engine.classifyEntry(e.canonical); if (c.kind === "transfer" || c.kind === "void") settled.add(c.id); }
  const owedTransfers = transfers.filter((t) => !settled.has(t.id));
  const owedLines = engine.interleaveByDelivery(deliveries, owed, owedTransfers);
  return {
    problems: [],
    lines: entries.length === 0 ? [engine.rulesLine(genesisDate), ...owedLines] : owedLines,
    mints: owed.length,
    moved: owedTransfers.filter((t) => t.kind === "transfer").length,
    voided: owedTransfers.filter((t) => t.kind === "void").length,
    recorded: entries.length,
  };
}

/**
 * The pass: one store transaction. Record whatever git holds past the store
 * (the store reads git), decide from the store, sign the owed lines onto the
 * export, record them, commit the export. A refusal anywhere rolls the store
 * back and leaves the export as it arrived. Returns the summary, or throws.
 */
export async function mintFromStore(clone, { keyPem, message = "mint: crossing pass", env = process.env, engine = null } = {}) {
  const eng = engine ?? await engineOf(clone);
  const { officeWrite } = await import("../../src/world2-pen.mjs");
  const ledger = join(clone, "WHITE_PAGES", "stamp-ledger.md");
  const arrived = existsSync(ledger) ? readFileSync(ledger, "utf8") : null;
  try {
    return await officeWrite(async (client) => {
      await syncStampLinesVia(client, clone, { engine: eng });
      const inputs = await mintInputsVia(client);
      if (!inputs.rooms.size) throw new Error("town_rooms is empty: the store has no key base yet (apply 065 and run the town-index ingest)");
      if (!inputs.mailLines.length) throw new Error("town_mail_lines is empty: the store has no deliveries yet (apply 065 and run the town-index ingest)");
      const entries = await stampLinesVia(client);
      if (!entries.length) throw new Error("stamp_lines is empty: record the chain first (stamp-lines.mjs --sync)");
      const d = owedFromStore(eng, { entries, ...inputs });
      if (d.problems.length) throw new Error(`the recorded ledger diverges from the derivation; nothing appended\n${d.problems[0]}`);
      if (!d.lines.length) return { appended: 0, summary: "stamp-ledger: up to date — nothing to mint" };
      eng.appendSigned(clone, d.lines, keyPem);
      const rec = await syncStampLinesVia(client, clone, { engine: eng });
      if (rec.inserted !== d.lines.length) throw new Error(`signed ${d.lines.length} line(s) and the store recorded ${rec.inserted}; nothing committed`);
      // ONLY A GREEN VERIFY COMMITS, as it did when the chain verified before
      // its own commit (the ferry's POS-295 rule): the town's verifier over the
      // export, every check it makes, before the commit and inside the store
      // transaction, so a red one rolls both back.
      const { verifyStampLedger } = await import(pathToFileURL(join(clone, "tools", "stamp-verify.mjs")).href);
      const v = verifyStampLedger(clone);
      if (!v.ok) throw new Error(`stamp-verify is red over the appended ledger; nothing committed\n${v.problems[0]}`);
      const commit = penCommit(clone, [ledger], message);
      return {
        appended: d.lines.length, commit,
        summary: `stamp-ledger: appended ${d.lines.length} line(s) — ${d.mints} mint(s), ${d.moved} transfer(s), ${d.voided} void(s) (${d.recorded} already recorded), decided from the store`,
      };
    }, { env });
  } catch (e) {
    // The export goes back to its arrival bytes: a pass that did not land leaves
    // nothing behind (penCommit has already unmade an unlanded commit).
    if (arrived != null && existsSync(ledger) && readFileSync(ledger, "utf8") !== arrived) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(ledger, arrived);
    }
    throw e;
  }
}

function arg(name, fallback = null) { const i = process.argv.indexOf(`--${name}`); return i === -1 ? fallback : process.argv[i + 1]; }

async function main() {
  if (!process.argv.includes("--append")) { console.error("say --append"); return 1; }
  const clone = resolve(arg("clone", process.env.TOWN_CLONE ?? process.cwd()));
  const keyPath = arg("key");
  if (!keyPath || !existsSync(keyPath)) { console.error("--append needs --key <ed25519-private-pem>"); return 1; }
  if (!existsSync(join(clone, "tools", "stamp-mint.mjs"))) { console.error(`no town clone with tools/stamp-mint.mjs at ${clone}`); return 1; }
  try {
    const out = await mintFromStore(clone, { keyPem: readFileSync(keyPath, "utf8"), message: arg("message", "mint: crossing pass") });
    console.log(out.summary);
    return 0;
  } catch (e) { console.error(`FATAL: ${e.message}`); return 1; }
}

// Entry guard: real paths, the junction lesson (town-index-ingest.mjs § entry guard).
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) process.exitCode = await main();
