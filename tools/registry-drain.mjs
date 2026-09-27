#!/usr/bin/env node
// registry-drain.mjs — the store -> the town's two files (POS-187).
//
// The household registry is store-of-record (019_households.sql). This is the
// drain that makes the town repo's two JSON files a RENDERING of it:
//
//   node tools/registry-drain.mjs --check    render, diff against the clone,
//                                            exit 0 on byte-equality or 1
//                                            naming the first differing line —
//                                            or the rows the store is MISSING
//   node tools/registry-drain.mjs --apply    write and commit both files
//                                            through the town pen, only when
//                                            they differ, and REFUSE rather
//                                            than shrink the registry
//   node tools/registry-drain.mjs --ingest-missing --reason "…"
//                                            adopt the rows the files hold and
//                                            the store does not, print each,
//                                            then drain naming them
//
// ── `--check` IS THE GATE, NOT A REPORT ─────────────────────────────────────
//
// It answers exactly one question — does the store render today's real files,
// byte for byte — and it is the condition on every later step. It runs at the
// crossing, before anything trusts the store, and its red is the whole flip
// stopping. The law it enforces is `src/registry-rows.mjs`'s header:
//
//     renderRegistry(rowsFromRegistry(the files)) === the files
//
// proven there against the 2026-09-22 fixtures, and proven HERE against
// whatever the clone holds this morning. The two are the same law read from
// the two ends: the test proves the fold and unfold compose, `--check` proves
// the STORE still holds what the fold put in it.
//
// ── `--apply` COMMITS THROUGH THE TOWN PEN AND NOTHING ELSE ─────────────────
//
// `penCommit` (src/write.mjs:43) — the one ceremony every office write to the
// town clone goes through: stage, commit as the office bot with the stable
// author string, push when `TOWN_PUSH=1`, and verify the commit is an ancestor
// of `origin/main` before calling it landed. It RETURNS NULL FOR AN EMPTY DIFF,
// so idempotence is not something this file implements — it is something the
// pen already guarantees, and a drain that re-rendered identical bytes commits
// nothing and says so.
//
// A second writer here would be the thing this whole lane exists to end. There
// is one pen and one pool: reads go through `actsQuery`'s pool
// (src/world2-acts.mjs), writes go through `penCommit`.
//
// ── `drainRegistry()` IS EXPORTED FOR POS-158 ───────────────────────────────
//
// The mint writes its house to the table and then calls this, in the same act,
// so the file never lags the row by a crossing. It takes an injected `commit`
// exactly as `declareHousehold` does, so a falsifier can prove the whole
// decision path without a clone or a pen.
//
// ── ENV ─────────────────────────────────────────────────────────────────────
//
//   TOWN_CLONE      the town checkout the files are diffed against / written to
//   TOWN_PUSH=1     push the commit (penCommit's own gate)
//   BOT_NAME / BOT_EMAIL   the pen's author string
//   WORLD2_PG=1 + WORLD2_PG_URL    the office's record connection (office_api)
//
// Nothing is sourced and no secret is printed.

import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { renderRegistry, firstDifferingLine, rowsFromRegistry } from "../src/registry-rows.mjs";
import { loadRegistryRows, upsertHousehold, upsertPin } from "../src/registry-store.mjs";
import { REGISTRY_PATH, PINS_PATH } from "../src/residency.mjs";
import { penCommit } from "../src/write.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const CLONE = opt("--clone", process.env.TOWN_CLONE ?? resolve(HERE, "..", "town-clone"));

const readFile = (clone, rel) => {
  try { return readFileSync(join(clone, rel), "utf8"); } catch { return null; }
};

const parseFile = (clone, rel) => {
  const raw = readFile(clone, rel);
  if (raw === null) return null;
  try { return JSON.parse(raw); } catch { return null; }
};

// ── THE DRAIN NEVER SHRINKS THE REGISTRY (POS-158, Keemin 2026-09-22) ───────
//
// THE HAZARD THIS CLOSES, exactly. `renderRegistry` renders the WHOLE registry
// from the table and `--apply` writes it over the town's file. So a house that
// stands in the FILE and not in the TABLE is DELETED by the next drain — and
// there is a road that produces exactly that state: the town's witness rule 2b
// still lets a bound resident edit their own row in a hand PR, and until that
// flips (a TOWN PR, at the ship, not this lane's) a merge can put a house in
// the file that no office door ever minted.
//
// POS-187 stopped one course below this wall; the office's own writers all
// close in this lane's PR, and this is the guard that makes the last road safe.
// It is the same failure `src/registry-store.mjs:36-44` warns about — "a
// reader switched to the store today would read a table frozen at its seed,
// fold over it, and commit a file that DROPS every house declared since" —
// arriving from the write side instead of the read side.
//
// SO THE DRAIN REFUSES RATHER THAN RENDERS. If the file holds a house or a pin
// the table lacks, nothing is written and nothing is committed, and the refusal
// NAMES each missing row so a person can act on it. A drain that shrank the
// registry by one row and said "byte-equal" afterwards is the one outcome this
// whole lane exists to make impossible.
//
// The repair is a DOOR, not a silent fold: `--ingest-missing --reason "…"`
// below, which upserts the file-only rows into the table, prints each, and
// names them in the commit. Adopting them silently inside the drain would make
// the drain a second writer with no receipt, which is the thing POS-187's
// header calls "the thing this whole lane exists to end".
//
/**
 * What the FILE holds that the TABLE does not.
 *
 * Pure: two parsed files and the store's rows in, two lists of keys out. The
 * comparison is by KEY ONLY — a row whose CONTENT differs is an ordinary diff
 * and `--check` already names its line. This is about rows that would VANISH.
 */
export function missingFromStore(rows, householdsJson, pinsJson) {
  const inTable = new Set((rows?.households ?? []).map((r) => r.slug));
  const pinsInTable = new Set((rows?.pins ?? []).map((r) => r.handle));
  const households = Object.keys(householdsJson?.households ?? {}).filter((s) => !inTable.has(s));
  const pins = Object.keys(pinsJson ?? {}).filter((h) => !pinsInTable.has(h));
  return { households, pins };
}

const MISSING_SENTENCE = (missing) =>
  `the town's files hold ${missing.households.length} household(s) and ${missing.pins.length} pin(s) this store does not: `
  + [...missing.households.map((s) => `household \`${s}\``), ...missing.pins.map((h) => `pin \`${h}\``)].join(", ")
  + ` — the drain renders the WHOLE registry, so writing now would DELETE them. Nothing was written and nothing was committed.`
  + ` Adopt them with: node tools/registry-drain.mjs --ingest-missing --reason "<where they came from>"`;

/**
 * Render the store and compare it to a clone's two files.
 *
 * `{ ok, rows, rendered, diffs }`. `diffs` is one entry per file that differs,
 * each carrying the 1-based first differing line and both sides of it, because
 * a red that says only "they differ" is a red nobody can act on at 05:45.
 */
export async function checkRegistry({ clone = CLONE, env = process.env } = {}) {
  const rows = await loadRegistryRows(env);
  if (rows === null)
    return { ok: false, rows: null, rendered: null, unreachable: true, diffs: [], missing: { households: [], pins: [] } };

  // THE SHRINK CHECK RUNS FIRST, and it is a different question from the diff.
  // A differing LINE is a row whose content moved; a MISSING ROW is a house
  // that would stop existing. The gate answers both, and it says which.
  const missing = missingFromStore(rows, parseFile(clone, REGISTRY_PATH), parseFile(clone, PINS_PATH));
  const shrinks = missing.households.length > 0 || missing.pins.length > 0;

  const rendered = renderRegistry(rows);
  const diffs = [];
  for (const [path, got] of [[REGISTRY_PATH, rendered.households], [PINS_PATH, rendered.pins]]) {
    const actual = readFile(clone, path);
    if (actual === null) { diffs.push({ path, missing: true }); continue; }
    const d = firstDifferingLine(got, actual);
    if (d) diffs.push({ path, ...d });
  }
  return { ok: diffs.length === 0 && !shrinks, rows, rendered, diffs, missing, shrinks };
}

/**
 * Adopt the rows the file holds and the table does not — the repair door.
 *
 * `--ingest-missing --reason "…"`. It is deliberately a SEPARATE ACT from the
 * drain: adopting somebody's row into the store is a judgment about where that
 * row came from, and a judgment with no receipt is how a second writer hides.
 * Every adopted row is printed, and the drain that follows names them and the
 * reason in its commit message.
 *
 * `ord` COMES FROM THE FILE, because the file's declaration order is the thing
 * `ord` exists to hold (019's header: nothing derives it). A house appended to
 * the file by a merge — which is where every one of these comes from, since
 * `planRegistryJoin` appends — lands at the end, past every ord the table
 * holds, and slots in cleanly. A file ord already held by a DIFFERENT slug is
 * refused by name rather than guessed at: the unique index would refuse it
 * anyway, and refusing here says which two rows disagree.
 */
export async function ingestMissing({ clone = CLONE, env = process.env, reason = null } = {}) {
  const rows = await loadRegistryRows(env);
  if (rows === null)
    return { ran: false, unreachable: true, adopted: { households: [], pins: [] } };

  const householdsJson = parseFile(clone, REGISTRY_PATH);
  const pinsJson = parseFile(clone, PINS_PATH);
  const missing = missingFromStore(rows, householdsJson, pinsJson);
  if (!missing.households.length && !missing.pins.length)
    return { ran: true, adopted: { households: [], pins: [] }, note: "nothing in the files that the store does not already hold" };

  // The file, folded into rows by the SAME fold the seed uses, so an adopted
  // row is spelled exactly as a seeded one. `rowsFromRegistry` throws on a key
  // it has no column for, which is the right answer here too: a row carrying a
  // field this store cannot render must not be adopted into it silently.
  const fileRows = rowsFromRegistry(householdsJson ?? {}, pinsJson ?? {});
  const bySlug = new Map(fileRows.households.map((r) => [r.slug, r]));
  const byHandle = new Map(fileRows.pins.map((r) => [r.handle, r]));
  const ordHeld = new Map((rows.households ?? []).map((r) => [Number(r.ord), r.slug]));

  const adopted = { households: [], pins: [] };
  for (const slug of missing.households) {
    const row = bySlug.get(slug);
    const held = ordHeld.get(Number(row.ord));
    if (held !== undefined && held !== slug)
      throw new Error(`registry-drain --ingest-missing: \`${slug}\` sits at position ${row.ord} in ${REGISTRY_PATH}, and the store already holds \`${held}\` at that position — two rows cannot claim one place. Nothing was adopted. A person decides which order is the town's.`);
    await upsertHousehold(row, env);
    ordHeld.set(Number(row.ord), slug);
    adopted.households.push({ slug, ord: row.ord, name: row.name ?? null });
  }
  for (const handle of missing.pins) {
    await upsertPin(byHandle.get(handle), env);
    adopted.pins.push({ handle, login: byHandle.get(handle).login });
  }
  return { ran: true, adopted, reason };
}

/** The line a commit and a receipt both say about an adoption. */
export const adoptionNote = (adopted, reason) =>
  `adopted from the town's files: `
  + [...adopted.households.map((h) => `household ${h.slug}`), ...adopted.pins.map((p) => `pin ${p.handle}`)].join(", ")
  + (reason ? ` — ${reason}` : " — no reason given");

/**
 * Write and commit both files, only when they differ.
 *
 * `commit` is injected (the real `penCommit` in production, a capture in test)
 * so the whole decision path is provable without a clone or a pen — the same
 * seam `declareHousehold` uses for exactly the same reason.
 *
 * Returns `{ ran, commit, changed, counts }`. `commit: null` with
 * `changed: []` is the ordinary idempotent case, not a failure.
 */
export async function drainRegistry({ clone = CLONE, env = process.env, commit = penCommit, note = null } = {}) {
  const rows = await loadRegistryRows(env);
  if (rows === null)
    return { ran: false, skipped: "this office is not pointed at the record — nothing was rendered and nothing was written", commit: null, changed: [] };

  // THE SHRINK GUARD, BEFORE A SINGLE BYTE. See § THE DRAIN NEVER SHRINKS THE
  // REGISTRY above. This runs ahead of the render because a render that is
  // about to be refused should not have been computed, and more importantly
  // because every caller of this function is mid-ceremony holding a pen: a
  // refusal has to arrive before anything is staged.
  const missing = missingFromStore(rows, parseFile(clone, REGISTRY_PATH), parseFile(clone, PINS_PATH));
  if (missing.households.length || missing.pins.length)
    return { ran: false, refused: MISSING_SENTENCE(missing), missing, commit: null, changed: [] };

  const rendered = renderRegistry(rows);
  const counts = { households: rows.households.length, pins: rows.pins.length };

  const changed = [];
  const paths = [];
  for (const [rel, content] of [[REGISTRY_PATH, rendered.households], [PINS_PATH, rendered.pins]]) {
    const abs = join(clone, rel);
    if (readFile(clone, rel) !== content) { writeFileSync(abs, content); changed.push(rel); }
    paths.push(abs);
  }

  // Both paths are staged either way. `penCommit` returns null on an empty
  // diff, so handing it the unchanged one costs nothing and keeps the commit a
  // single act over both files — which is the shape every other town write
  // holds (src/declare.mjs § ONE COMMIT, BOTH OR NEITHER).
  const sha = changed.length
    ? commit(clone, paths, `registry: ${counts.households} households, ${counts.pins} pins rendered from the store (via postmark-office, registry-drain)`
        + (note ? `\n\n${note}` : ""))
    : null;

  return { ran: true, commit: sha, changed, counts };
}

async function main() {
  const CHECK = flag("--check");
  const APPLY = flag("--apply");
  const INGEST = flag("--ingest-missing");
  const chosen = [CHECK, APPLY, INGEST].filter(Boolean).length;
  if (chosen !== 1) {
    console.error("registry-drain: pass exactly one of --check, --apply or --ingest-missing\n"
      + "  --check           renders the store and diffs it against the clone's two files; 0 = byte-equal, 1 = names the first differing line OR the rows the store is missing\n"
      + "  --apply           writes and commits both files through the town pen, only when they differ — and REFUSES rather than shrink the registry\n"
      + "  --ingest-missing  adopts the rows the files hold and the store does not, then drains; needs --reason \"<where they came from>\"");
    process.exit(1);
  }

  if (INGEST) {
    const reason = opt("--reason", null);
    if (!reason) {
      console.error("registry-drain --ingest-missing: pass --reason \"<where these rows came from>\"\n"
        + "  Adopting a row into the store is a judgment about its provenance, and a judgment with no receipt is how a second writer hides.\n"
        + "  The reason is printed, and it rides the drain's commit message.");
      process.exit(2);
    }
    const r = await ingestMissing({ clone: CLONE, reason });
    if (r.unreachable) {
      console.error("registry-drain --ingest-missing: this office is not pointed at the record (WORLD2_PG=1 and WORLD2_PG_URL are what point it) — nothing was adopted");
      process.exit(1);
    }
    if (!r.adopted.households.length && !r.adopted.pins.length) {
      console.error(`registry-drain --ingest-missing: ${r.note}`);
      process.exit(0);
    }
    for (const h of r.adopted.households)
      console.error(`  adopted household \`${h.slug}\` at position ${h.ord}${h.name ? ` (${h.name})` : " (no name stated)"}`);
    for (const p of r.adopted.pins)
      console.error(`  adopted pin \`${p.handle}\` -> @${p.login}`);
    const note = adoptionNote(r.adopted, reason);
    const d = await drainRegistry({ clone: CLONE, note });
    if (!d.ran) { console.error(`registry-drain --ingest-missing: the drain after the adoption did not run: ${d.refused ?? d.skipped}`); process.exit(1); }
    console.error(`registry-drain --ingest-missing: ${note}`);
    console.error(d.changed.length
      ? `  then wrote ${d.changed.join(", ")}, commit ${d.commit ?? "(empty diff — the pen committed nothing)"}`
      : "  the files already match the store — nothing written, nothing committed");
    process.exit(0);
  }

  if (CHECK) {
    const r = await checkRegistry({ clone: CLONE });
    if (r.unreachable) {
      console.error("registry-drain --check: this office is not pointed at the record (WORLD2_PG=1 and WORLD2_PG_URL are what point it) — the gate did not run, and an un-run gate is not a pass");
      process.exit(1);
    }
    if (r.shrinks) {
      console.error(`registry-drain --check: ${MISSING_SENTENCE(r.missing)}`);
      process.exit(1);
    }
    if (r.ok) {
      console.error(`registry-drain --check: byte-equal — ${r.rows.households.length} households, ${r.rows.pins.length} pins render ${REGISTRY_PATH} and ${PINS_PATH} exactly as ${CLONE} holds them`);
      process.exit(0);
    }
    for (const d of r.diffs) {
      if (d.missing) { console.error(`registry-drain --check: ${d.path} is missing from ${CLONE}`); continue; }
      console.error(`registry-drain --check: ${d.path} differs at line ${d.line}`);
      console.error(`  store renders: ${d.rendered}`);
      console.error(`  the clone has: ${d.actual}`);
    }
    console.error("the store does not render the town's files — nothing may read it as the record until this exits 0");
    process.exit(1);
  }

  const r = await drainRegistry({ clone: CLONE });
  if (!r.ran) { console.error(`registry-drain --apply: ${r.refused ?? r.skipped}`); process.exit(1); }
  if (!r.changed.length) {
    console.error(`registry-drain --apply: both files already match the store (${r.counts.households} households, ${r.counts.pins} pins) — nothing written, nothing committed`);
    process.exit(0);
  }
  console.error(`registry-drain --apply: wrote ${r.changed.join(", ")} (${r.counts.households} households, ${r.counts.pins} pins), commit ${r.commit ?? "(empty diff — the pen committed nothing)"}`);
  process.exit(0);
}

// ── the entrypoint ──────────────────────────────────────────────────────────
//
// Only run when invoked as a script: this module is imported by POS-158's mint
// and by `test/registry-drain.test.mjs`, and an import that ran a drain would
// be a door nobody opened.
//
// THE JUNCTION LESSON (HQ memory `junctions-defeat-main-guards`, and this
// repo's own `test/cli-guard.test.mjs`): `pathToFileURL(process.argv[1]).href
// === import.meta.url` is FALSE when the entry reaches this file through a
// Windows junction — the ESM loader realpaths the entry, argv[1] does not — and
// the tool then exits 0 having done nothing, which for a GATE reads exactly
// like "byte-equal". Compare REAL paths; the URL compare is only the fallback
// for an argv[1] that cannot be realpath'd. This tool is on that test's roster.
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();

if (isMain) main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
