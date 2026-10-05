#!/usr/bin/env node
// standing-drain.mjs — the store -> the town's standing ledger (POS-347).
//
// The standing ledger is store-of-record (060_standing_acts.sql). This is the
// drain that makes the town repo's `tools/standing-ledger.md` a RENDERING of
// it, in the registry drain's shape (tools/registry-drain.mjs):
//
//   node tools/standing-drain.mjs --check    render, diff against the clone:
//                                            0 on byte-equality, 1 naming the
//                                            first differing line or the lines
//                                            the store does not hold yet
//   node tools/standing-drain.mjs --apply    adopt the file's lines the store
//                                            lacks, then write and commit the
//                                            file through the town pen, only
//                                            when it differs
//
// ── THE STORE READS GIT (Darko, 2026-10-04) ─────────────────────────────────
//
// Git can be written to. A line the town file holds and the store does not —
// the backfill on the first run, or a Registrar line committed by hand with
// the town's own CLI after it — is ADOPTED into the store with source `git`,
// in file order, before anything renders. Each adoption is named in the commit
// and on stderr. Two things are never adopted and never dropped: a line that
// looks like an act but does not parse (the drain refuses, naming it, because
// a malformed line could be a quarantine nobody can see), and nothing else is
// ever removed from the store, so a hand edit that DELETES a line is undone by
// the next render rather than obeyed. An act is undone with a `lift`.
//
// The adoption runs in `--apply` and in the Registrar's door (src/standing-
// door.mjs), never in `--check`: `--check` only reads.
//
// ── `--apply` COMMITS THROUGH THE TOWN PEN AND NOTHING ELSE ─────────────────
//
// `penCommit` (src/write.mjs), which returns null for an empty diff, so a
// drain that re-rendered identical bytes commits nothing and says so.
//
// ── ENV ─────────────────────────────────────────────────────────────────────
//
//   TOWN_CLONE      the town checkout the file is diffed against / written to
//   TOWN_PUSH=1     push the commit (penCommit's own gate)
//   BOT_NAME / BOT_EMAIL   the pen's author string
//   WORLD2_PG=1 + WORLD2_PG_URL    the office's record connection (office_api)
//
// Nothing is sourced and no secret is printed.

import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { STANDING_LEDGER_PATH } from "../src/standing.mjs";
import { loadStandingActs, insertStandingActs, missingFromStore, renderStandingLedger } from "../src/standing-store.mjs";
import { penCommit } from "../src/write.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const CLONE = opt("--clone", process.env.TOWN_CLONE ?? resolve(HERE, "..", "town-clone"));

const readLedger = (clone) => {
  try { return readFileSync(join(clone, STANDING_LEDGER_PATH), "utf8"); } catch { return null; }
};

/** First differing line (1-based) of two texts, or null when equal. */
export function firstDifferingLine(a, b) {
  if (a === b) return null;
  const x = String(a ?? "").split("\n");
  const y = String(b ?? "").split("\n");
  for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) return i + 1;
  return null;
}

export const UNPARSED_SENTENCE = (unparsed) =>
  `the town's ${STANDING_LEDGER_PATH} holds ${unparsed.length} act-shaped line(s) the grammar cannot read, so the current standing is not knowable and nothing was adopted or rendered — a person fixes them:\n  ${unparsed.join("\n  ")}`;

/**
 * Read only: does the store render today's file byte for byte?
 * `{ ran, equal, line, missing, unparsed }`; `ran: false` when not pointed at the record.
 */
export async function checkStanding({ clone = CLONE, env = process.env } = {}) {
  const records = await loadStandingActs(env);
  if (records === null) return { ran: false };
  const file = readLedger(clone);
  const { missing, unparsed } = file === null ? { missing: [], unparsed: [] } : missingFromStore(file, records);
  const rendered = renderStandingLedger(file, records);
  const line = firstDifferingLine(rendered, file ?? "");
  return { ran: true, equal: line === null, line, missing, unparsed, count: records.length };
}

/**
 * Adopt the file's lines the store lacks, in file order (source `git`).
 * Answers `{ adopted: [record…] }`, `{ refused }` on an unreadable line, or
 * `{ skipped }` when not pointed at the record. Exported for the door, which
 * runs it under the same lock before its own act.
 */
export async function adoptFromGit({ clone = CLONE, env = process.env } = {}) {
  const records = await loadStandingActs(env);
  if (records === null) return { skipped: "this office is not pointed at the record" };
  const file = readLedger(clone);
  if (file === null) return { adopted: [], records };
  const { missing, unparsed } = missingFromStore(file, records);
  if (unparsed.length) return { refused: UNPARSED_SENTENCE(unparsed), unparsed };
  if (!missing.length) return { adopted: [], records };
  const adopted = await insertStandingActs(missing, { source: "git" }, env);
  return { adopted, records: await loadStandingActs(env) };
}

export const adoptionNote = (adopted) =>
  `adopted from the town's file (the store reads git): ${adopted.map((r) => `${r.date} ${r.act} ${r.handle}`).join(", ")}`;

/**
 * Adopt, then write and commit the file, only when it differs. `commit` is
 * injected (the real `penCommit` in production, a capture in a test).
 * Returns `{ ran, adopted, changed, commit }`, or `{ ran: false, refused|skipped }`.
 */
export async function drainStanding({ clone = CLONE, env = process.env, commit = penCommit, note = null } = {}) {
  const a = await adoptFromGit({ clone, env });
  if (a.skipped) return { ran: false, skipped: a.skipped, adopted: [], changed: false, commit: null };
  if (a.refused) return { ran: false, refused: a.refused, adopted: [], changed: false, commit: null };
  const file = readLedger(clone);
  const rendered = renderStandingLedger(file, a.records);
  if (file === rendered) return { ran: true, adopted: a.adopted, changed: false, commit: null, count: a.records.length };
  const abs = join(clone, STANDING_LEDGER_PATH);
  writeFileSync(abs, rendered);
  const lines = [note, a.adopted.length ? adoptionNote(a.adopted) : null].filter(Boolean);
  const sha = commit(clone, [abs],
    `standing: ${a.records.length} acts rendered from the store (via postmark-office, standing-drain)`
      + (lines.length ? `\n\n${lines.join("\n\n")}` : ""));
  return { ran: true, adopted: a.adopted, changed: true, commit: sha, count: a.records.length };
}

async function main() {
  const CHECK = flag("--check");
  const APPLY = flag("--apply");
  if (CHECK === APPLY) {
    console.error("standing-drain: pass exactly one of --check or --apply\n"
      + "  --check   renders the store and diffs it against the clone's standing ledger; 0 = byte-equal, 1 = names the first differing line or the lines the store does not hold\n"
      + "  --apply   adopts the file's lines the store lacks (the store reads git), then writes and commits the file through the town pen, only when it differs");
    process.exit(2);
  }
  if (CHECK) {
    const r = await checkStanding();
    if (!r.ran) {
      console.error("standing-drain --check: this office is not pointed at the record (WORLD2_PG=1 and WORLD2_PG_URL are what point it) — the gate did not run, and an un-run gate is not a pass");
      process.exit(1);
    }
    if (r.unparsed.length) { console.error(`standing-drain --check: ${UNPARSED_SENTENCE(r.unparsed)}`); process.exit(1); }
    if (r.missing.length) {
      console.error(`standing-drain --check: the store does not hold ${r.missing.length} line(s) the file holds (--apply adopts them):\n  ${r.missing.map((m) => m.line).join("\n  ")}`);
      process.exit(1);
    }
    if (!r.equal) { console.error(`standing-drain --check: ${STANDING_LEDGER_PATH} differs at line ${r.line}`); process.exit(1); }
    console.error(`standing-drain --check: byte-equal — ${r.count} acts render ${STANDING_LEDGER_PATH} exactly as ${CLONE} holds it`);
    return;
  }
  const r = await drainStanding();
  if (!r.ran) { console.error(`standing-drain --apply: ${r.refused ?? r.skipped}`); process.exit(1); }
  if (r.adopted.length) console.error(`standing-drain --apply: ${adoptionNote(r.adopted)}`);
  if (!r.changed) { console.error(`standing-drain --apply: the file already matches the store (${r.count} acts) — nothing written, nothing committed`); return; }
  console.error(`standing-drain --apply: wrote ${STANDING_LEDGER_PATH} (${r.count} acts), commit ${r.commit ?? "(empty diff — the pen committed nothing)"}`);
}

// Only run when invoked as a script (the door and the tests import it). Real
// paths, never the URL compare alone: the junction lesson registry-drain.mjs
// names, and `test/cli-guard.test.mjs` holds.
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();

if (isMain) main().then(() => process.exit(0), (e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
