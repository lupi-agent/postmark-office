// welcome-pass.mjs — the office drain that pays the welcome bundle at a crossing.
//
// ── WHY THIS FILE EXISTS: A PROMISE WITH NO KEEPER ──────────────────────────
//
// The welcome bundle is founder-ruled (2026-09-14): every household, once, at
// its first resident, ✦5 for joining. The town shipped the law and both verbs
// (`stamp-mint.mjs --welcome-plan` / `--welcome`) and the 112 standing
// households were minted BY HAND the same day. Three surfaces then went to
// press saying the office does the rest:
//
//   • the town's registry row: "the office writes the bundle at a crossing;
//     joining is the whole of the doing" (quest-registry.json, `awaits`);
//   • the town's grammar note: "written by the office drain at a crossing"
//     (stamp-mint.mjs, above WELCOME_RE);
//   • the `--welcome` verb's own header: "The normal writer is the office drain
//     at a crossing; this verb is that ceremony exposed for the retroactive
//     pass and for repair, never a second law."
//
// There was no drain. MEASURED, not assumed, before this file was written: the
// crossing's mint pass is `stamp-mint.mjs --append`, and `--append` appends
// `walkLedger`'s owed lines — DERIVED mints, recomputed from the mail. A
// welcome is not derived; it is an in-place assertion, folded from the rows
// already recorded (`deriveTransfers`: `else if (c.kind === 'welcome') add(...)`)
// and never generated. `grep -rn -- "--welcome" ` over this whole repo returned
// NOTHING on the train tip: the office had no welcome code of any kind. So six
// households that joined after the by-hand pass were reading a registry row
// promising them a bundle no scheduled thing would ever write.
//
// ── WHAT IT DOES ────────────────────────────────────────────────────────────
//
//   node deploy/welcome-pass.mjs --town <clone> --key <pem> [--date YYYY-MM-DD]
//   node deploy/welcome-pass.mjs --town <clone> --dry-run
//
// Reads the town's OWN plan (`--welcome-plan`, which writes nothing and needs no
// key) and runs the town's OWN `--welcome` verb once per owed household. This
// office decides NOTHING about who is owed, which resident receives, or what a
// bundle is worth: the roll, the meep exclusion, the first-resident tie-break
// (earliest `pinned` in tools/github-ids.json, ties alphabetical, unpinned last)
// and the ✦5 all live in the town and are read from it. A second copy of the
// first-resident rule here is precisely the drift `STANDING_FACT`'s bound
// falsifier exists to prevent, one door over.
//
// ── WHO AND WHICH HOUSE COME FROM THE STORE (POS-344, w42) ─────────────────
//
// The town's verbs used to read who is bound, which declared house a resident
// stands in, and the first-resident pin dates from the printed
// tools/households.json and tools/github-ids.json. Those files are the store's
// printout (registry-drain.mjs), so a house the ceremony bound and the drain had
// not yet printed waited a crossing, and a hand edit to a printout could make
// somebody owed. This pass reads the registry from the store
// (`loadRegistryRows`), writes it to a file beside the run as
// `{ households, pins }`, and hands it to both verbs with `--registry`. A
// store it cannot read is a refusal: nothing is planned and nothing is paid,
// and the household keeps its claim for the next crossing.
//
// ── IDEMPOTENT IN TWO PLACES, AND THE OUTER ONE IS NOT THE GUARD ────────────
//
// The plan re-reads the sealed ledger every run, so a welcomed household simply
// is not in the owed list on the next tick. That is the ordinary path, and it is
// NOT what makes a second pass safe: the town's `--welcome` refuses on its own
// — "FATAL: household already holds its welcome bundle … once per household,
// ever" — resolving the payer's house the way the verifier resolves it, so a
// re-key cannot smuggle a second bundle past either. The falsifier drives the
// SECOND apply and asserts the refusal, because a guard proven only by the list
// upstream of it is a guard nothing has tested.
//
// ── THE PARSE IS BOUND, NOT TRUSTED ─────────────────────────────────────────
//
// The plan is prose, and this reads it. A wording change in the town would
// otherwise leave this parser finding zero owed rows and reporting a cheerful
// "nothing owed" forever — the silent-failure shape that is worse than a crash.
// So `parseWelcomePlan` reads the plan's OWN count out of its header line and
// refuses when the rows it parsed do not match it. The town changing its words
// reds the suite and stops the pass; it never quietly empties it.
//
// ── ORDER, AND WHY IT IS NOT FREE ───────────────────────────────────────────
//
// `--welcome` refuses onto an unsettled tail ("ledger is behind the mail … run
// --append first") and refuses a date before the ledger's last ("append-only,
// forward-dated"). So this runs AFTER the tick's `--append` and BEFORE
// `stamp-verify` + the commit, inside the same flock and with the same key, so
// the bundles it writes are verified and pushed by the pass already there.
//
// EXIT: 0 when every owed bundle was written (or none was owed), 1 when any
// refused — with each refusal named. The tick treats a non-zero as non-fatal and
// says so in the journal: a household waits one crossing, it does not lose a
// bundle.
//
// What keeps the ledger from being left half-verified is the TICK, not this
// file. This pass appends and returns; on 2026-09-28 its line then sat
// uncommitted in the town clone for 4.5 h because the verify after it failed on
// an older line and nothing put the file back (POS-295). The tick now refuses to
// run the pass onto a ledger that arrives red, and restores the ledger's arrival
// bytes from an EXIT trap when the verify after it fails (deploy/office-tick.sh
// § WHOLE OR NOTHING). A bundle rolled back that way is still owed, so the plan
// names the household again on the next tick.

import { spawnSync } from "node:child_process";
import { existsSync, realpathSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadRegistryRows } from "../src/registry-store.mjs";
import { registryFromRows, pinsFromRows } from "../src/registry-rows.mjs";

/** The town's own household-key grammar (stamp-mint.mjs HOUSEHOLD_KEY). */
const HOUSEHOLD_KEY_RE = /^[a-z0-9][a-z0-9-]*:[a-z0-9][a-z0-9._-]*$/;

/**
 * The plan's header, which carries the count this parse is checked against:
 *   `welcome plan — 118 household(s) in the roll, 112 already welcomed, 6 owed`
 */
const HEADER_RE = /^welcome plan — (\d+) household\(s\) in the roll, (\d+) already welcomed, (\d+) owed$/;

/**
 * One owed row:
 *   `  rook-of-all-sorts · gh:256883703 · (rook-of-all-sorts) · pinned 2026-09-14`
 * The residents list and the pin tail are read but not used to decide anything —
 * they are carried into the receipt so an operator reading the journal can see
 * WHICH house was paid and on whose arrival, without opening the ledger.
 */
const OWED_RE = /^ {2}(\S+) · (\S+) · \(([^)]*)\)(?: · (.*))?$/;

/**
 * The town's plan, read. PURE — no spawn, no clone — so the falsifiers drive
 * this exact function against real captured output rather than a copy of it.
 *
 * Throws on a plan it cannot account for. That is deliberate and it is the whole
 * point of the function: the alternative to throwing is returning an empty owed
 * list, which reads identically to "the town owes nobody" at every surface
 * downstream and would have this pass report success forever.
 */
export function parseWelcomePlan(stdout) {
  const lines = String(stdout ?? "").split(/\r?\n/);
  const header = lines.map((l) => HEADER_RE.exec(l.trim())).find(Boolean);
  if (!header) {
    throw new Error(
      "welcome-pass: the town's --welcome-plan did not print a header this office can read. "
      + "Expected `welcome plan — N household(s) in the roll, N already welcomed, N owed`. "
      + "The town's wording has changed and this parser must be trued to it before the pass can run again.");
  }
  const [, rollS, welcomedS, owedS] = header;
  const claimed = Number(owedS);

  const start = lines.findIndex((l) => l.startsWith("OWED"));
  const owed = [];
  if (start !== -1) {
    for (const line of lines.slice(start + 1)) {
      if (line.trim() === "") break;
      if (line.startsWith("ALREADY WELCOMED")) break;
      const m = OWED_RE.exec(line);
      if (!m) {
        throw new Error(`welcome-pass: unreadable row in the town's owed list: ${JSON.stringify(line)}`);
      }
      const [, first, household, residents, tail] = m;
      if (!HOUSEHOLD_KEY_RE.test(household)) {
        throw new Error(`welcome-pass: the owed list named "${household}", which is not a household key — refusing to mint against it`);
      }
      owed.push({
        first,
        household,
        residents: residents.split(", ").filter(Boolean),
        note: tail ?? null,
      });
    }
  }

  // ⚑ THE BIND. The plan's own number against the rows we found.
  if (owed.length !== claimed) {
    throw new Error(
      `welcome-pass: the town's plan says ${claimed} household(s) owed and this office parsed ${owed.length}. `
      + "Refusing to mint a set it cannot fully account for — a partial read of the owed list is how a household "
      + "silently never gets its bundle.");
  }

  return { roll: Number(rollS), welcomed: Number(welcomedS), owed };
}

/** The town's day, the same clock `--welcome-plan` reads its own `today` on. */
export function townDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: process.env.TOWN_TZ ?? "America/New_York" }).format(now);
}

/**
 * The town's own tool, named by absolute path and handed `--repo` explicitly.
 *
 * Both halves are deliberate. The path is resolved from `--town` rather than the
 * cwd so this cannot silently run some OTHER clone's copy of the mint when the
 * tick's subshell has moved; `--repo` is passed for the same reason, because
 * `stamp-mint.mjs` otherwise falls back to a DEFAULT_REPO of its own. A pass
 * that signs against a clone it was not pointed at is the worst failure this
 * file could have, and it would leave a perfectly valid receipt.
 */
export const mintArgv = (town, args) => [join(town, "tools", "stamp-mint.mjs"), ...args, "--repo", town];

const run = (town, args) =>
  spawnSync(process.execPath, mintArgv(town, args), {
    cwd: town, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  });

/**
 * The store's registry as the town's verbs read it: `{ households, pins }`,
 * the same two shapes as the printouts. Null when the store could not be read.
 * `rows` is injectable so the suite drives a store it seeded.
 */
export async function storeRegistry(rows = undefined) {
  const got = rows === undefined ? await loadRegistryRows() : rows;
  if (!got) return null;
  return { households: registryFromRows(got).households ?? {}, pins: pinsFromRows(got) };
}

const arg = (name, argv) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };

export async function main(argv = process.argv.slice(2), { registryRows = undefined } = {}) {
  const town = arg("--town", argv);
  const keyPath = arg("--key", argv);
  const date = arg("--date", argv) ?? townDate();
  const dryRun = argv.includes("--dry-run");

  if (!town || !existsSync(town)) {
    console.error("welcome-pass: --town <town-clone> is required and must exist");
    return 1;
  }
  if (!dryRun && (!keyPath || !existsSync(keyPath))) {
    console.error("welcome-pass: --key <ed25519-private-pem> is required (or --dry-run)");
    return 1;
  }

  let registry;
  try { registry = await storeRegistry(registryRows); } catch (e) { registry = null; console.error(`welcome-pass: ${e?.message ?? e}`); }
  if (!registry) {
    console.error("welcome-pass: the store's registry could not be read — nothing planned, nothing paid; every owed house keeps its claim for the next crossing");
    return 1;
  }
  const scratch = mkdtempSync(join(tmpdir(), "welcome-pass-"));
  const registryFile = join(scratch, "registry.json");
  writeFileSync(registryFile, JSON.stringify(registry));
  try { return await pass(town, keyPath, date, dryRun, registryFile); }
  finally { rmSync(scratch, { recursive: true, force: true }); }
}

async function pass(town, keyPath, date, dryRun, registryFile) {
  const plan = run(town, ["--welcome-plan", "--registry", registryFile]);
  if (plan.status !== 0) {
    console.error(`welcome-pass: the town's --welcome-plan failed (exit ${plan.status})\n${plan.stderr ?? ""}`);
    return 1;
  }

  let parsed;
  try { parsed = parseWelcomePlan(plan.stdout); }
  catch (e) { console.error(e.message); return 1; }

  if (parsed.owed.length === 0) {
    console.log(`[welcome-pass] nothing owed — ${parsed.roll} household(s) in the roll, all ${parsed.welcomed} welcomed`);
    return 0;
  }

  console.log(`[welcome-pass] ${parsed.owed.length} household(s) owed a welcome bundle (${parsed.owed.length * 5} stamps), date ${date}`);

  if (dryRun) {
    for (const o of parsed.owed) {
      console.log(`[welcome-pass] would mint ✦5 → ${o.first} · ${o.household} · (${o.residents.join(", ")})${o.note ? ` · ${o.note}` : ""}`);
    }
    console.log("[welcome-pass] dry run — nothing written, nothing signed");
    return 0;
  }

  const refused = [];
  for (const o of parsed.owed) {
    // ONLY households the plan named, one line each, the town's own verb. No
    // amount, no authority, no household resolution of ours: every term of the
    // bundle is pinned in the town and held again at verify.
    const r = run(town, ["--welcome", o.first, "--household", o.household, "--date", date, "--key", keyPath, "--registry", registryFile]);
    if (r.status === 0) {
      console.log(`[welcome-pass] minted ✦5 → ${o.first} · ${o.household}`);
    } else {
      const why = (r.stderr ?? "").trim().split(/\r?\n/)[0] || `exit ${r.status}`;
      console.error(`[welcome-pass] REFUSED ${o.first} · ${o.household} — ${why}`);
      refused.push({ ...o, why });
    }
  }

  if (refused.length) {
    console.error(`[welcome-pass] ${parsed.owed.length - refused.length} of ${parsed.owed.length} written; ${refused.length} refused — `
      + "each refusal is the town declining, not this pass failing to ask. The household keeps its claim and the next crossing asks again.");
    return 1;
  }
  console.log(`[welcome-pass] ${parsed.owed.length} bundle(s) written`);
  return 0;
}

// ── entry guard ──────────────────────────────────────────────────────────────
// Script only when run as one, so the suite can import the pure halves and drive
// `main` in-process. The idiom is settlement-history.mjs's, and the realpath
// compare is the junction lesson (2026-09-05): `pathToFileURL(process.argv[1])
// .href === import.meta.url` is FALSE when the entry reaches this file through a
// Windows junction — the ESM loader realpaths the entry, argv[1] is not — so the
// tool exits 0 having done nothing, which for THIS tool means a crossing that
// silently pays no bundles. test/cli-guard.test.mjs spawns it both ways.
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) process.exit(await main());
