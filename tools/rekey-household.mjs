// rekey-household.mjs — give a household a new key and name, keeping everything else.
//
// POS-299 (Keemin, 2026-09-29). Emmett Songbound's human typed the whole
// introduction into the household field at the join, so the house's key is an
// 858-character slug and its human speaks in every conversation as
// `human-of-<that paragraph>`. This is the ruled rename: a new key and display
// name for ONE household, with its residents, pins and membership unchanged,
// and nothing re-paid.
//
//   node tools/rekey-household.mjs --from <slug> --to <slug> --name "<display>" [--dry-run]
//
// Run it on the box under the town lock, with the office's env (the store, the
// pen key, TOWN_CLONE, TOWN_PUSH). `--dry-run` prints exactly what would change
// and writes nothing.
//
// WHAT MOVES, AND WHAT DELIBERATELY DOES NOT:
//
//   · THE STORE: one UPDATE of the `households` row (`renameHousehold`): the
//     slug and the name change, and the old key joins `formerly`. Pins carry no
//     slug, and the membership is the row's own `residents`.
//   · ROWS SPELLED `hh:<old key>` (acts, claims, marks, events, opens) DO NOT
//     MOVE, and cannot: a row's household spelling is fixed for its life
//     (024_household_spellings.sql, the store's three guards). They stay the
//     house's own because every reader compares against the house's spelling
//     set, which carries `hh:<every formerly key>`
//     (src/household-deriver.mjs § houseKeysOf).
//   · THE TOWN FILES: the registry drain prints tools/households.json from the
//     store, and each resident's ADDRESS (and berth) `household:` line is
//     rewritten where it carried the old name or key.
//   · THE LEDGER is append-only. A resident whose latest sealed `registry:` line
//     names `hh:<old key>` gets one more, `registry: <handle> = hh:<new key>`,
//     signed by the office pen. The ledger folds those lines in order, so the
//     later one is the handle's key from its date on; the welcome plan marks a
//     paid house under the key its recipient wears now, so nothing is re-paid.
//     The line is dated by the US Eastern date of the moment it is written, and
//     never earlier than the ledger's tail.
//
// ONE COMMIT holds the printed registers, the card lines and the ledger line.
// The store row is written before the commit, so a push that cannot land
// leaves the store renamed; running the same command again RESUMES (it finds
// the new key with the old one in `formerly`) and lands the files.

import { readFileSync, writeFileSync, realpathSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { loadRegistryRows, renameHousehold } from "../src/registry-store.mjs";
import { registryFromRows, pinsFromRows, renderRegistry } from "../src/registry-rows.mjs";
import { slugIsWellFormed, collectingDrain } from "../src/ceremony.mjs";
import { isHouseholdName } from "../src/declare.mjs";
import { registryLine, signedRegistryLines } from "../src/town-drain.mjs";
import { penCommit, penTransaction, landOrRefuse } from "../src/write.mjs";
import { REGISTRY_PATH, PINS_PATH } from "../src/residency.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const LEDGER = "WHITE_PAGES/stamp-ledger.md";

export const REKEY_REFUSALS = Object.freeze({
  BAD_SLUG: { code: 422, defect: "--to is not a key: 2–40 characters of lowercase letters, digits and single hyphens" },
  NOT_A_NAME: { code: 422, defect: "--name is not a household name: at most 60 characters, one line, no second sentence" },
  NO_SOURCE: { code: 404, defect: "no household stands at --from" },
  TARGET_EXISTS: { code: 409, defect: "--to is already a household's key, or a key some household once carried" },
  COLLATERAL: { code: 409, defect: "printing the registry would change more than the named household — the town's files are behind the store elsewhere; run the registry drain first" },
  NO_RECORD: { code: 503, defect: "the office cannot reach the town's record — nothing was written" },
  LEDGER_AHEAD: { code: 409, defect: "the ledger's last line is dated after today (US Eastern); a line may not be dated before the tail" },
  DRAIN_REFUSED: { code: 409, defect: "the registry drain refused to print" },
});

const refuse = (r, detail = null) => Object.assign(new Error(r.defect), { code: r.code, defect: r.defect, detail });

/** Today's date in the town's zone, the date every ledger writer uses. */
export const easternDate = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: process.env.TOWN_TZ ?? "America/New_York" }).format(now);

// ── reading the town ────────────────────────────────────────────────────────

const read = (clone, rel) => { try { return readFileSync(join(clone, rel), "utf8"); } catch { return null; } };

/** Each handle's latest sealed `registry:` key, in ledger order, and the tail's date. */
export function ledgerRegistry(text) {
  const latest = new Map();
  let tail = null;
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const d = /^- (\d{4}-\d{2}-\d{2}) · /.exec(line);
    if (!d) continue;
    tail = d[1];
    const m = /^- \d{4}-\d{2}-\d{2} · registry: (\S+) = (\S+) · sig: /.exec(line);
    if (m) latest.set(m[1], m[2]);
  }
  return { latest, tail };
}

// A frontmatter `household:` line, rewritten only where it said the old name or key.
function withHouseLine(text, { oldValues, name }) {
  const fm = /^(---\r?\n)([\s\S]*?)(\r?\n---)/.exec(text);
  if (!fm) return null;
  const m = /^household:[ \t]*(.*?)[ \t]*$/m.exec(fm[2]);
  if (!m || !oldValues.includes(m[1].trim())) return null;
  const body = fm[2].replace(m[0], `household: ${name}`);
  return text.replace(fm[0], fm[1] + body + fm[3]);
}

// ── the plan ────────────────────────────────────────────────────────────────

/**
 * Everything the re-key would change, decided from the rows and the clone as
 * they stand. Pure but for reading the clone. Throws a named refusal.
 */
export function planRekey({ from, to, name, rows, clone, date }) {
  if (!slugIsWellFormed(to)) throw refuse(REKEY_REFUSALS.BAD_SLUG, to);
  if (!isHouseholdName(name)) throw refuse(REKEY_REFUSALS.NOT_A_NAME, name);

  const registry = registryFromRows(rows);
  const houses = registry.households ?? {};
  const target = houses[to];
  // A re-run after the store row moved but the files did not land: finish it.
  const resuming = !houses[from] && Boolean(target) && (target.formerly ?? []).includes(from);
  if (!houses[from] && !resuming) throw refuse(REKEY_REFUSALS.NO_SOURCE, from);
  if (!resuming) {
    const worn = target ? to : Object.keys(houses).find((s) => (houses[s].formerly ?? []).includes(to));
    if (worn) throw refuse(REKEY_REFUSALS.TARGET_EXISTS, worn === to ? `${to} stands` : `${worn} once carried ${to}`);
  }

  const before = resuming ? { ...target, formerly: (target.formerly ?? []).filter((f) => f !== from) } : houses[from];
  const formerly = [...new Set([...(before.formerly ?? []), from])];
  const row = rows.households.find((r) => r.slug === (resuming ? to : from));
  const after = { ...rows, households: rows.households.map((r) => (r === row
    ? { ...r, slug: to, name, formerly, provisional: false } : r)) };

  // COLLATERAL: what the drain would print must differ from the town's files
  // only in the named household. Anything else means the files are behind the
  // store somewhere else, and this act would carry that change unasked.
  const printed = renderRegistry(after);
  const filesHouses = JSON.parse(read(clone, REGISTRY_PATH) ?? "{}").households ?? {};
  const printedHouses = JSON.parse(printed.households).households ?? {};
  const moved = [];
  for (const k of new Set([...Object.keys(filesHouses), ...Object.keys(printedHouses)])) {
    if (k === from || k === to) continue;
    if (JSON.stringify(filesHouses[k]) !== JSON.stringify(printedHouses[k])) moved.push(k);
  }
  if ((read(clone, PINS_PATH) ?? "") !== printed.pins) moved.push("tools/github-ids.json");
  if (moved.length) throw refuse(REKEY_REFUSALS.COLLATERAL, moved.slice(0, 8).join(", ") + (moved.length > 8 ? `, +${moved.length - 8} more` : ""));

  // The residents' cards and berths, where they carried the old name or key.
  const residents = [...(before.residents ?? [])];
  const oldValues = [before.name, from].filter(Boolean).map((v) => String(v).trim());
  const cards = [];
  for (const h of residents) {
    for (const rel of [`WHITE_PAGES/${h}/ADDRESS.md`, `HARBOR/berths/${h}.md`]) {
      const text = read(clone, rel);
      const next = text == null ? null : withHouseLine(text, { oldValues, name });
      if (next != null && next !== text) cards.push({ path: rel, content: next });
    }
  }

  // The ledger: one line per resident whose latest sealed key is the old one.
  const { latest, tail } = ledgerRegistry(read(clone, LEDGER));
  if (tail && tail > date) throw refuse(REKEY_REFUSALS.LEDGER_AHEAD, `tail ${tail}, today ${date}`);
  const ledger = residents.filter((h) => latest.get(h) === `hh:${from}`).map((h) => registryLine(date, h, to));

  return {
    from, to, name, resuming, residents, formerly,
    store: resuming ? null : { table: "households", slug: [from, to], name: [before.name ?? null, name], formerly },
    registry: { before: filesHouses[from] ?? filesHouses[to] ?? null, after: printedHouses[to] },
    cards, ledger, date,
  };
}

// ── the act ─────────────────────────────────────────────────────────────────

/**
 * Plan, and unless `dryRun`, do it: the store row, the printed registers, the
 * card lines and the ledger line, in one pen commit. `sign` and `drainWith` are
 * the pen's own, injected in test.
 */
export async function rekeyHousehold({ from, to, name, clone, env = process.env, date = easternDate(), dryRun = false,
  sign = signedRegistryLines, drainWith = collectingDrain } = {}) {
  const rows = await loadRegistryRows(env);
  if (rows === null) throw refuse(REKEY_REFUSALS.NO_RECORD);
  const plan = planRekey({ from, to, name, rows, clone, date });
  if (dryRun) return { dryRun: true, plan };

  const signed = plan.ledger.length ? sign(clone, plan.ledger) : [];
  const paths = [];
  for (const c of plan.cards) { writeFileSync(join(clone, c.path), c.content); paths.push(join(clone, c.path)); }

  if (!plan.resuming) {
    const moved = await renameHousehold({ from, to, formerly: plan.formerly, provisional: false, name }, env);
    if (moved === null) throw refuse(REKEY_REFUSALS.NO_RECORD, "the rename did not land");
  }

  const { drain, paths: printed } = drainWith({ clone, env });
  const drained = await drain({ note: `POS-299: ${to} re-keyed from ${from.slice(0, 60)}${from.length > 60 ? "…" : ""}` });
  if (drained?.refused) throw refuse(REKEY_REFUSALS.DRAIN_REFUSED, drained.refused);
  paths.push(...printed);

  if (signed.length) {
    const ledgerAbs = join(clone, LEDGER);
    const prior = readFileSync(ledgerAbs, "utf8");
    writeFileSync(ledgerAbs, prior.replace(/\s*$/, "\n") + signed.join("\n") + "\n");
    paths.push(ledgerAbs);
  }

  const commit = landOrRefuse(() => penCommit(clone, paths,
    `registry: ${to} — a household re-keyed, its residents and pins unchanged (via postmark-office, rekey-household, POS-299)`));
  if (commit?.error) throw Object.assign(new Error(commit.error.defect), commit.error);
  return { dryRun: false, plan, commit, ledger: signed };
}

// ── the command ─────────────────────────────────────────────────────────────

const arg = (name, argv) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };

function describe(plan, { dryRun }) {
  const out = [];
  out.push(`${dryRun ? "DRY RUN — nothing written." : "RE-KEYED."} ${plan.resuming ? "(resuming: the store row had already moved)" : ""}`.trim());
  out.push(`household: ${plan.from.length > 70 ? plan.from.slice(0, 70) + `… (${plan.from.length} chars)` : plan.from}`);
  out.push(`       to: ${plan.to}  ·  name: "${plan.name}"`);
  out.push(`residents (unchanged, pins unchanged): ${plan.residents.join(", ") || "(none)"}`);
  out.push(plan.store
    ? `store: households — 1 row: slug and name change; formerly becomes [${plan.formerly.map((f) => (f.length > 40 ? f.slice(0, 40) + "…" : f)).join(", ")}]`
    : "store: no change (already re-keyed)");
  out.push("store: rows spelled hh:<old key> (acts, claims, marks, events, opens) keep that spelling; the house's spelling set carries it through formerly");
  out.push(`town files: ${REGISTRY_PATH} (the one household), ${plan.cards.map((c) => c.path).join(", ") || "no card line to change"}`);
  out.push(plan.ledger.length ? `ledger: append ${plan.ledger.length} signed line(s):` : "ledger: no line (no resident's latest sealed key is the old one)");
  for (const l of plan.ledger) out.push(`  ${l} · sig: <the office pen>`);
  return out.join("\n");
}

export async function main(argv = process.argv.slice(2)) {
  const from = arg("--from", argv), to = arg("--to", argv), name = arg("--name", argv);
  if (!from || !to || !name) {
    console.error('rekey-household: --from <slug> --to <slug> --name "<display>" are required ([--dry-run])');
    return 1;
  }
  const clone = process.env.TOWN_CLONE ?? resolve(HERE, "..", "town-clone");
  const dryRun = argv.includes("--dry-run");
  try {
    const out = await penTransaction(clone, async () => {
      if (!dryRun && process.env.TOWN_PUSH === "1") execFileSync("git", ["-C", clone, "pull", "--rebase", "-q"], { encoding: "utf8" });
      try { return await rekeyHousehold({ from, to, name, clone, dryRun }); }
      catch (e) {
        if (typeof e?.code !== "number") throw e;
        return { error: { code: e.code, defect: e.defect ?? String(e.message), detail: e.detail ?? null } };
      }
    });
    if (out?.error) { console.error(`rekey-household: REFUSED — ${out.error.defect}${out.error.detail ? ` (${out.error.detail})` : ""}`); return 1; }
    console.log(describe(out.plan, out));
    if (out.commit) console.log(`commit: ${out.commit}`);
    return 0;
  } catch (e) {
    console.error(`rekey-household: tripped — ${String(e?.stack ?? e).slice(0, 600)}`);
    return 1;
  }
}

// ── entry guard ── the realpath compare (test/cli-guard.test.mjs spawns it both ways)
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) process.exit(await main());
