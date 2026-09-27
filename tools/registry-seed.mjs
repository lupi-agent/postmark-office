#!/usr/bin/env node
// registry-seed.mjs — the household registry's ONE-TIME fill (POS-187).
//
// Reads the town clone's `tools/households.json` and `tools/github-ids.json`,
// folds them to rows (`src/registry-rows.mjs rowsFromRegistry` — the same fold
// the drain unfolds), and fills `households`, `household_pins` and
// `registry_meta`.
//
//   node tools/registry-seed.mjs --dry-run      prints the rows and the counts, exit 0
//   node tools/registry-seed.mjs --apply        inserts, or REFUSES if not empty
//
// `--dry-run` touches no database at all: it reads two files and folds them,
// which is why it is the step that runs first on the box and why it can run
// anywhere. `--apply` is the only path that connects.
//
// ── THE REFUSAL ─────────────────────────────────────────────────────────────
//
// `--apply` exits 1, naming the counts it found, unless all three tables are
// empty. This is a SEED and not a sync: it has no idea which of two disagreeing
// copies is newer, and a fill that merged over live rows would silently pick
// one. A second fill is a person's decision, made after they have looked.
//
// ── WHERE THE TOWN CLONE COMES FROM ─────────────────────────────────────────
//
// `TOWN_CLONE`, the same variable every other office reader of these two files
// uses (`src/households.mjs:28`, `src/declare-exec.mjs`), defaulting to the
// repo's own `town-clone/`. Pass `--clone <path>` to read another checkout.
//
// ── ENV ─────────────────────────────────────────────────────────────────────
//
//   TOWN_CLONE      the town checkout to read the two files from
//   WORLD2_PG=1     } together, the office's own record connection —
//   WORLD2_PG_URL   } role `office_api`, the one pool behind `actsQuery`
//
// Nothing is sourced and nothing is printed from a secrets file: the URL is
// read from the environment the unit already holds, and never echoed.

import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { rowsFromRegistry } from "../src/registry-rows.mjs";
import { insertRegistryRows, registryRowCounts } from "../src/registry-store.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const CLONE = opt("--clone", process.env.TOWN_CLONE ?? resolve(HERE, "..", "town-clone"));
const DRY = flag("--dry-run");
const APPLY = flag("--apply");

const die = (msg) => { console.error(msg); process.exit(1); };

function readTwo(clone) {
  const read = (rel) => {
    try { return JSON.parse(readFileSync(join(clone, rel), "utf8")); }
    catch (e) { die(`registry-seed: cannot read ${rel} in ${clone} — ${e?.message ?? e}`); }
  };
  return { households: read("tools/households.json"), pins: read("tools/github-ids.json") };
}

// ── THE CLONE'S RECEIPT, AND THE ONE THING IT CANNOT TELL YOU ───────────────
//
// A STALE CLONE IS THE WHOLE FAILURE MODE OF THIS TOOL, and it is not
// hypothetical: measured 2026-09-22, the office's own pool clone held 115
// households and 185 pins while town `origin/main` held 118 and 190 — three
// houses and five pins behind. `src/residency.mjs:540-546` names the same trap
// from the other side ("the clone lags its pull cron — it was 200 lines behind
// the day this shipped"). Seed from a clone in that state and the store starts
// three houses short; drain from it and the town's file is REVERTED to it,
// because a content revert rebases cleanly and the pen has nothing to conflict
// with.
//
// WHAT THIS CANNOT CHECK, SAID PLAINLY RATHER THAN GUARDED BADLY: whether the
// clone is behind the REMOTE. `git merge-base --is-ancestor origin/main HEAD`
// answers green on a clone whose own `origin/main` ref is equally stale —
// measured on that same pool clone, where HEAD and origin/main were the same
// sha and both were three houses old. A probe that cannot fail is not a probe,
// so that check is not written here. The INSTALL block pulls FIRST, and this
// prints the receipt a person reads to confirm it took.
//
// What it CAN check is that nobody is mid-edit in the clone, which is a real
// state with a real red.
function cloneReceipt(clone) {
  const git = (...args) => {
    try { return execFileSync("git", ["-C", clone, ...args], { encoding: "utf8" }).trim(); }
    catch { return null; }
  };
  // `git -C <dir>` WALKS UP to the nearest enclosing repository, so a path that
  // is not a checkout at all answers with some ancestor's HEAD and the receipt
  // reads like a clone that is merely old. Pin it: the toplevel must BE this
  // path, or the receipt says there is no checkout here rather than quoting a
  // sha from somewhere else on the disk.
  const top = git("rev-parse", "--show-toplevel");
  const isRoot = top && resolve(top) === resolve(clone);
  if (!isRoot) return { head: null, households_at: null, pins_at: null, dirty: "", notARepo: true, foundInstead: top };
  return {
    head: git("rev-parse", "HEAD"),
    households_at: git("log", "-1", "--format=%cI", "--", "tools/households.json"),
    pins_at: git("log", "-1", "--format=%cI", "--", "tools/github-ids.json"),
    dirty: git("status", "--porcelain", "--", "tools/households.json", "tools/github-ids.json") || "",
  };
}

async function main() {
  if (DRY === APPLY)
    die("registry-seed: pass exactly one of --dry-run or --apply\n"
      + "  --dry-run  reads the two files, folds them, prints the rows and the counts; no database\n"
      + "  --apply    inserts them, and refuses if the tables already hold rows");

  const { households, pins } = readTwo(CLONE);
  const rows = rowsFromRegistry(households, pins);
  const counts = { households: rows.households.length, pins: rows.pins.length, meta: Object.keys(rows.meta).length };

  const receipt = cloneReceipt(CLONE);
  const sayReceipt = () => {
    console.error(`  clone ${CLONE}`);
    if (receipt.notARepo)
      console.error(`  HEAD (no git checkout AT this path${receipt.foundInstead ? `; the nearest repository above it is ${receipt.foundInstead}` : ""})`);
    else console.error(`  HEAD ${receipt.head}`);
    console.error(`  tools/households.json last committed ${receipt.households_at ?? "(unknown)"}`);
    console.error(`  tools/github-ids.json  last committed ${receipt.pins_at ?? "(unknown)"}`);
    console.error("  a clone that has not pulled reads three houses old and looks exactly like this one — pull before you believe these counts");
  };

  if (DRY) {
    // The rows themselves, so a person can read what is about to be written
    // rather than trusting a number. One JSON document, because a human pipes
    // this to a file and a machine pipes it to `jq`.
    process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
    console.error(`registry-seed --dry-run: ${counts.households} households, ${counts.pins} pins, ${counts.meta} meta keys`);
    sayReceipt();
    console.error("nothing was written; no database was opened");
    process.exit(0);
  }

  if (receipt.dirty && !flag("--allow-dirty-clone"))
    die(`registry-seed --apply REFUSES: the clone has uncommitted changes to the registry files —\n${receipt.dirty}\n`
      + "A half-edited clone is not a copy of the town's record, and the store would be seeded from whatever somebody left in the tree.\n"
      + "Commit or discard them, or pass --allow-dirty-clone if you know exactly what is in there. Nothing was written.");

  const held = await registryRowCounts();
  if (held === null)
    die("registry-seed --apply: this office is not pointed at the record (WORLD2_PG=1 and WORLD2_PG_URL are what point it) — nothing was written");

  const nonEmpty = Object.entries(held).filter(([, n]) => n > 0);
  if (nonEmpty.length)
    die(`registry-seed --apply REFUSES: the registry tables are not empty — ${nonEmpty.map(([k, n]) => `${k} ${n}`).join(", ")}.\n`
      + "This is a seed, not a sync: it cannot know which of two disagreeing copies is newer, and a fill that merged over live rows would silently pick one.\n"
      + "Nothing was written. A second fill is a decision a person makes after looking.");

  const wrote = await insertRegistryRows(rows);
  console.error(`registry-seed --apply: wrote ${wrote.households} households, ${wrote.pins} pins, ${wrote.meta} meta keys`);
  sayReceipt();
  console.error("now run `node tools/registry-drain.mjs --check` — it must exit 0 before anything reads the store");
  process.exit(0);
}

// ── the entrypoint ──────────────────────────────────────────────────────────
//
// GUARDED, because an unguarded CLI tail runs at IMPORT and its `process.exit`
// kills the importer — the class `test/cli-guard.test.mjs` exists to catch, and
// this tool is on that test's roster.
//
// THE JUNCTION LESSON (HQ memory `junctions-defeat-main-guards`):
// `pathToFileURL(process.argv[1]).href === import.meta.url` is FALSE when the
// entry reaches this file through a Windows junction — the ESM loader realpaths
// the entry, argv[1] does not — and the tool then exits 0 having done nothing,
// which for a SEED reads exactly like "already filled". Compare REAL paths; the
// URL compare is only the fallback for an argv[1] that cannot be realpath'd.
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();

if (isMain) main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
