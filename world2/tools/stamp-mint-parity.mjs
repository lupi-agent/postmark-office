#!/usr/bin/env node
// stamp-mint-parity.mjs — THE GATE BEFORE THE MINT READS THE STORE (POS-341, Q3).
//
// Ruled by Darko, 2026-10-04: the mint's key base comes from the store
// (household_pins, town_rooms, and solo: keys), and before anything mints from
// it, base(store) = base(file) for every handle, and a full replay is green
// with the store's inputs injected. This tool is that gate. It is read-only: it
// writes nothing, anywhere.
//
//   node world2/tools/stamp-mint-parity.mjs [--clone <town clone>] [--json]
//
// It compares, side by side:
//
//   the key base     src/mint-inputs.mjs § keyBaseOf over the store's rows,
//                    against the town's householdKeys over the clone, handle by
//                    handle (key and provisional)
//   the deliveries   the town's parseDeliveries over the store's raw mail lines,
//                    against the same function over the clone's file, delivery
//                    by delivery, `pays` included
//   the ledger       stamp_lines against the clone's file, line by line, when the
//                    store holds the chain (until its first sync it holds none,
//                    and the file's lines stand in, said so in the report)
//   the replay       the mint's own --append derivation (deriveMints,
//                    deriveFriendshipMints, combineDerived, walkLedger,
//                    deriveTransfers) run twice: once on the store's inputs, once
//                    on the file's. Green is no problem on either side and the
//                    same mints and settlements owed on both.
//   the control      the town's own verifyStampLedger over the clone, untouched.
//
// Exit 0: parity (and the control green). 1: a difference, named. 2: could not run.
// A difference is a STOP (the ruling): it is reported, never reconciled here.

import { existsSync, realpathSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { mintInputsVia, keyBaseOf, sealedDatesOf, deliveriesOf } from "../../src/mint-inputs.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The mint's --append derivation over one set of inputs: what it finds wrong, and what it owes. */
export function replayOf(engine, { entries, deliveries, households }) {
  const { laws, revisions } = engine.parseLaws(entries);
  const recorded = entries.map((e) => e.canonical);
  const genesisDate = deliveries[0]?.date ?? "2026-06-12";
  const problems = [];
  if (recorded.length && recorded[0] !== engine.rulesLine(genesisDate))
    problems.push(`line 1: the ledger does not open with "${engine.rulesLine(genesisDate)}"`);
  const corr = engine.deriveMints(deliveries, households, { laws, revisions });
  const friend = engine.deriveFriendshipMints(deliveries, households, { laws, revisions });
  const mints = engine.combineDerived(deliveries, corr, friend);
  const walk = engine.walkLedger(recorded.slice(1), mints, 1);
  problems.push(...walk.problems);
  const transfers = engine.deriveTransfers(deliveries, households, { laws, revisions }, entries);
  const settled = new Set();
  for (const e of entries) { const c = engine.classifyEntry(e.canonical); if (c.kind === "transfer" || c.kind === "void") settled.add(c.id); }
  const owedSettlements = transfers.filter((t) => !settled.has(t.id));
  return {
    problems,
    mints: mints.length,
    owed: walk.owed.map(engine.derivedLine),
    owed_settlements: owedSettlements.map(engine.economyLine),
  };
}

const keyOf = (v) => (v ? `${v.key}${v.provisional ? " (provisional)" : ""}` : "(none)");
const dKey = (d) => JSON.stringify([d.date, d.id, d.from, d.to, d.pays ?? null]);

/**
 * The comparison, pure over what each side holds. `store` is `{ pins, rooms,
 * mailLines, entries }` (entries null when stamp_lines is empty); the file side
 * is read from `clone` by the town's own functions.
 */
export function parityOf(engine, clone, store) {
  const fileEntries = engine.parseStampLedger(readFileSync(join(clone, "WHITE_PAGES", "stamp-ledger.md"), "utf8"));
  const storeEntries = store.entries && store.entries.length ? store.entries : null;
  const entries = storeEntries ?? fileEntries;
  const report = { ok: true, notes: [], base: {}, deliveries: {}, ledger: {}, replay: {}, control: {} };

  // the key base
  const fileBase = engine.householdKeys(clone);
  const storeBase = keyBaseOf({ pins: store.pins, rooms: store.rooms, sealed: sealedDatesOf(engine, entries) });
  const handles = [...new Set([...fileBase.keys(), ...storeBase.keys()])].sort();
  const baseDiffs = handles.filter((h) => keyOf(fileBase.get(h)) !== keyOf(storeBase.get(h)))
    .map((h) => ({ handle: h, file: keyOf(fileBase.get(h)), store: keyOf(storeBase.get(h)) }));
  report.base = { handles: handles.length, file: fileBase.size, store: storeBase.size, differ: baseDiffs.length, diffs: baseDiffs.slice(0, 50) };

  // the deliveries
  const fileDel = engine.parseDeliveries(clone);
  const storeDel = deliveriesOf(engine, store.mailLines);
  let firstDiff = null;
  for (let i = 0; i < Math.max(fileDel.length, storeDel.length); i++)
    if (dKey(fileDel[i] ?? {}) !== dKey(storeDel[i] ?? {})) { firstDiff = { at: i + 1, file: fileDel[i] ?? null, store: storeDel[i] ?? null }; break; }
  report.deliveries = { file: fileDel.length, store: storeDel.length, with_pays: storeDel.filter((d) => d.pays != null).length, first_difference: firstDiff };

  // the ledger
  if (!storeEntries) {
    report.notes.push("stamp_lines is empty: the store holds no chain yet, so the file's lines stood in for the ledger on both sides");
    report.ledger = { store: 0, file: fileEntries.length, first_difference: null };
  } else {
    let at = null;
    for (let i = 0; i < Math.max(storeEntries.length, fileEntries.length); i++)
      if ((storeEntries[i]?.raw ?? null) !== (fileEntries[i]?.raw ?? null)) { at = i + 1; break; }
    report.ledger = { store: storeEntries.length, file: fileEntries.length, first_difference: at };
  }

  // the replay, twice
  const onStore = replayOf(engine, { entries, deliveries: storeDel, households: storeBase });
  const onFile = replayOf(engine, { entries: fileEntries, deliveries: fileDel, households: fileBase });
  report.replay = {
    store: { problems: onStore.problems, mints: onStore.mints, owed: onStore.owed.length, owed_settlements: onStore.owed_settlements.length },
    file: { problems: onFile.problems, mints: onFile.mints, owed: onFile.owed.length, owed_settlements: onFile.owed_settlements.length },
    same_owed: JSON.stringify([onStore.owed, onStore.owed_settlements]) === JSON.stringify([onFile.owed, onFile.owed_settlements]),
  };

  // the control: the town's own verifier over the export, untouched
  const control = typeof engine.verifyStampLedger === "function" ? engine.verifyStampLedger(clone) : null;
  report.control = control ?? { note: "the control runs in main(), which imports tools/stamp-verify.mjs" };

  report.ok = baseDiffs.length === 0 && !firstDiff && report.ledger.first_difference == null
    && onStore.problems.length === 0 && onFile.problems.length === 0 && report.replay.same_owed;
  return report;
}

function arg(name, fallback = null) { const i = process.argv.indexOf(`--${name}`); return i === -1 ? fallback : process.argv[i + 1]; }

async function main() {
  const clone = resolve(arg("clone", process.env.TOWN_CLONE ?? resolve(HERE, "..", "..", "town-clone")));
  if (!existsSync(join(clone, "tools", "stamp-mint.mjs"))) { console.error(`no town clone with tools/stamp-mint.mjs at ${clone}`); return 2; }
  const engine = await import(pathToFileURL(join(clone, "tools", "stamp-mint.mjs")).href);
  const { verifyStampLedger } = await import(pathToFileURL(join(clone, "tools", "stamp-verify.mjs")).href);
  const { officeRead } = await import("../../src/world2-pen.mjs");
  const { stampLinesVia } = await import("../../src/stamp-lines.mjs");
  let store;
  try {
    store = await officeRead(async (q) => ({ ...(await mintInputsVia(q)), entries: await stampLinesVia(q) }));
  } catch (e) { console.error(`the store could not be read: ${e.message}`); return 2; }
  if (!store.rooms.size || !store.mailLines.length) { console.error("town_rooms or town_mail_lines is empty: run the town-index ingest after 065 first"); return 2; }
  const report = parityOf(engine, clone, store);
  const control = verifyStampLedger(clone);
  report.control = { ok: control.ok, problems: control.problems.slice(0, 5) };
  report.ok = report.ok && control.ok;
  if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`key base   : ${report.base.handles} handles (file ${report.base.file}, store ${report.base.store}), ${report.base.differ} differ`);
    for (const d of report.base.diffs) console.log(`  ${d.handle}: file ${d.file} · store ${d.store}`);
    console.log(`deliveries : file ${report.deliveries.file}, store ${report.deliveries.store} (${report.deliveries.with_pays} with pays)${report.deliveries.first_difference ? `, FIRST DIFFERENCE at ${report.deliveries.first_difference.at}` : ", equal"}`);
    console.log(`ledger     : store ${report.ledger.store}, file ${report.ledger.file}${report.ledger.first_difference ? `, FIRST DIFFERENCE at line ${report.ledger.first_difference}` : ""}`);
    console.log(`replay     : store ${report.replay.store.problems.length} problem(s), ${report.replay.store.mints} mints, owed ${report.replay.store.owed}+${report.replay.store.owed_settlements} · file ${report.replay.file.problems.length} problem(s), ${report.replay.file.mints} mints, owed ${report.replay.file.owed}+${report.replay.file.owed_settlements} · ${report.replay.same_owed ? "same owed" : "OWED DIFFERS"}`);
    for (const p of [...report.replay.store.problems, ...report.replay.file.problems]) console.log(`  ${p}`);
    console.log(`control    : stamp-verify over the export ${control.ok ? "green" : "RED"}`);
    for (const n of report.notes) console.log(`note       : ${n}`);
    console.log(report.ok ? "PARITY" : "DIFFERENCE: stop, report it, reconcile nothing (POS-341 ruling)");
  }
  return report.ok ? 0 : 1;
}

// Entry guard: real paths, the junction lesson (town-index-ingest.mjs § entry guard).
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) process.exitCode = await main();
