// registry-backfill.mjs — EVERY HOUSEHOLD IN THE ROLL GETS EXACTLY ONE ROW.
//
// RULED (Keemin, 2026-09-22, POS-159). The town's roll is its ADDRESS cards:
// one `WHITE_PAGES/<handle>/ADDRESS.md` per resident, each naming the house it
// belongs to. The registry is the store (019/020/021, POS-187 + POS-158). This
// tool is the one place those two are reconciled, and it reconciles them in ONE
// direction only: a house the ROLL holds and the REGISTRY does not gets a row.
//
// It never edits a standing row, never removes one, and never touches a
// resident's card. The registry is store-of-record and the cards are what
// residents wrote; a tool that "fixed" either from the other would be a second
// writer with no receipt, which is the thing POS-187 exists to end.
//
// ── WHAT IT DOES TODAY: NOTHING, AND IT SAYS SO ─────────────────────────────
//
// Measured 2026-09-22 (town `origin/main` 1cd13ff57): 188 residents on the
// roll, 0 houses without a row, so `--dry-run` plans 0 and `--apply` writes 0.
// That is the answer, not a failure, and the dry run prints the roads every
// resident was found by so a reader can tell "everybody has a row" apart from
// "the roll did not load". The 09-21 note's "3 of 119" does not reproduce; the
// gap is that 24 residents state a household LABEL the registry does not carry
// as a slug, and all 24 are found by their account.
//
// ── THE ROLL IS READ FROM A CHECKOUT, AND THE CARDS ARE MIXED EOL ───────────
//
// `--town <path>` is an ordinary working checkout (default the office's own
// town clone). MEASURED AND IT CHANGED THE ANSWER: the town's cards are not all
// LF — `sable`'s is CRLF in the blob, and on Windows every card is CRLF after a
// checkout, because git applies the line-ending filter on the way out. A
// frontmatter reader whose value pattern ends in `$` does not match a line with
// a carriage return on it, and a card read that way looks like a card that
// states no household — a silent hole in the roll, in the exact shape this tool
// exists to count. So the reader normalises before it parses, and the dry run
// prints how many cards arrived CRLF.
//
// ── USAGE ───────────────────────────────────────────────────────────────────
//
//   node tools/registry-backfill.mjs --dry-run [--town <path>]
//   node tools/registry-backfill.mjs --apply   [--town <path>]
//
// WORLD2_PG=1 + WORLD2_PG_URL point the office at the record (role
// `office_api`). Nothing is sourced and no secret is printed.
//
// `--apply` REFUSES, without writing anything:
//   · when the office is not pointed at the record;
//   · when the store is EMPTY — the seed has not run, every slug looks free,
//     and a backfill against an empty roll would mint 100-odd duplicate houses
//     over the live registry. NULL IS NOT EMPTY and EMPTY IS NOT READY;
//   · when the plan carries any refusal (a house whose every borrowable key is
//     taken, or whose first resident's handle is not a lawful key);
//   · when any planned slug is taken, re-checked at the moment of writing.
//
// IT IS IDEMPOTENT. A second `--apply` plans zero, because the rows the first
// one wrote carry their residents and their first resident's account, and the
// planner finds a house by account, by name AND by the residents array
// (`src/registry-backfill.mjs` § THREE ROADS TO A HOUSE).
//
// ── ORDER AT THE SHIP ───────────────────────────────────────────────────────
//
//   1. world2/schema/021_households_provisional.sql   (after 019 and 020)
//   2. tools/registry-seed.mjs                        (if the store is empty)
//   3. node tools/registry-backfill.mjs --dry-run     (read it)
//   4. node tools/registry-backfill.mjs --apply
//   5. node tools/registry-drain.mjs --check          (must exit 0)

import { readFileSync, readdirSync, existsSync, realpathSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { planBackfill, rowForHouse } from "../src/registry-backfill.mjs";
import { loadRegistryRows, insertHousehold, upsertPin } from "../src/registry-store.mjs";
import { drainRegistry } from "./registry-drain.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const TOWN = opt("--town", process.env.TOWN_CLONE ?? resolve(HERE, "..", "town-clone"));
const WHITE_PAGES = "WHITE_PAGES";
const PINS_REL = join("tools", "github-ids.json");

// THE TEMPLATE IS NOT A RESIDENT. `WHITE_PAGES/TEMPLATE/ADDRESS.md` is the form
// a joining agent copies, and its own `handle:` line reads `your-handle`. It is
// excluded by THAT — the card's own word — rather than by its directory name,
// so a resident who one day takes the handle `template` is still a resident and
// a renamed form is still excluded.
const TEMPLATE_HANDLES = new Set(["your-handle"]);

/**
 * The frontmatter of one ADDRESS card.
 *
 * Normalises CRLF first. See § THE ROLL IS READ FROM A CHECKOUT above: this is
 * not tidiness, it is the difference between reading a card and losing it.
 */
export function frontmatter(raw) {
  const text = String(raw ?? "").replace(/\r\n/g, "\n");
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  if (end < 0) return null;
  const block = text.slice(text.indexOf("\n") + 1, end + 1);
  const fm = {};
  for (const line of block.split("\n")) {
    const m = /^([A-Za-z_][A-Za-z0-9_-]*):[ \t]?(.*)$/.exec(line);
    if (m) fm[m[1]] = m[2].trim();
  }
  return fm;
}

/**
 * The roll, read off a town checkout.
 *
 * `[{ handle, agent, household, joined, since, pin }]`, one per resident, plus
 * the counts a reader needs to believe it: how many directories were walked,
 * how many carried a card, how many arrived CRLF, and which were skipped.
 *
 * The HANDLE is the directory name, which is the resident's address. A card
 * whose own `handle:` disagrees is reported rather than silently trusted either
 * way — measured today, exactly one does, and it is the template.
 */
export function readRoll(town, pins = {}) {
  const base = join(town, WHITE_PAGES);
  if (!existsSync(base)) return { roll: [], walked: 0, carded: 0, crlf: 0, skipped: [], mismatched: [] };

  const dirs = readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  const roll = [];
  const skipped = [];
  const mismatched = [];
  let carded = 0;
  let crlf = 0;

  for (const handle of dirs.sort()) {
    const card = join(base, handle, "ADDRESS.md");
    if (!existsSync(card)) continue;
    carded++;
    const raw = readFileSync(card, "utf8");
    if (raw.includes("\r\n")) crlf++;
    const fm = frontmatter(raw);
    if (!fm) { skipped.push({ handle, why: "no frontmatter block" }); continue; }
    if (TEMPLATE_HANDLES.has(fm.handle)) { skipped.push({ handle, why: `the card's own handle reads "${fm.handle}" — this is the form, not a resident` }); continue; }
    if (fm.handle && fm.handle !== handle) mismatched.push({ handle, says: fm.handle });
    const pin = pins[handle] ?? null;
    roll.push({
      handle,
      agent: fm.agent ?? null,
      household: fm.household ?? null,
      joined: fm.joined ?? null,
      since: fm.since ?? null,
      pin: pin ? { login: pin.login, id: pin.id } : null,
    });
  }
  return { roll, walked: dirs.length, carded, crlf, skipped, mismatched };
}

const readPins = (town) => {
  try { return JSON.parse(readFileSync(join(town, PINS_REL), "utf8")); } catch { return {}; }
};

const say = (s) => console.error(s);

function printPlan(read, plan) {
  say(`registry-backfill: the roll at ${TOWN}`);
  say(`  ${read.walked} directories under ${WHITE_PAGES}/, ${read.carded} with an ADDRESS card, ${read.crlf} of them CRLF`);
  for (const s of read.skipped) say(`  skipped ${s.handle}: ${s.why}`);
  for (const m of read.mismatched) say(`  NOTE ${m.handle}: its card's handle line reads "${m.says}" — the directory is the address and the directory won`);
  say(`  ${plan.counts.residents} residents on the roll`);

  const roads = { account: 0, name: 0, residents: 0 };
  for (const r of plan.resolved) roads[r.road]++;
  say(`  ${plan.counts.resolved} already hold a row — ${roads.account} found by account, ${roads.name} by display name, ${roads.residents} by a house's residents list`);

  say("");
  if (!plan.houses.length) {
    say(`registry-backfill: ${plan.counts.planned} rows planned — every house in the roll already has one.`);
  } else {
    say(`registry-backfill: ${plan.counts.planned} rows planned, ${plan.counts.pins} pins to add`);
    for (const h of plan.houses) {
      say("");
      say(`  house  ${h.claimed ? JSON.stringify(h.claimed) : "(the card states no household)"}`);
      say(`    provisional slug  ${h.slug}${h.fallback ? "   (the handle itself was taken)" : ""}`);
      say(`    name              ${h.name}`);
      say(`    first resident    ${h.firstResident} (joined ${h.since ?? "unstated"})`);
      say(`    residents         ${h.residents.join(", ")}`);
      say(`    accounts          ${h.accounts.map((a) => "@" + a.login + " #" + a.id).join(", ") || "(none — no resident of this house carries a pin)"}`);
      // TWO DIFFERENT ZEROES, and they must not wear one sentence: a house
      // whose residents are all pinned already needs no pin written, and a
      // house where nobody is pinned at all has none to write. Reporting the
      // second as the first tells a reader that identities are on record when
      // none is.
      say(`    pins to add       ${h.pins.map((p) => p.handle + " -> @" + p.login).join(", ")
        || (h.accounts.length ? "(none — every resident is already pinned)" : "(none — no resident of this house carries a pin to write)")}`);
    }
  }
  if (plan.refusals.length) {
    say("");
    say(`registry-backfill: ${plan.refusals.length} house(s) this tool will NOT write:`);
    for (const r of plan.refusals) say(`  ${r.house}: ${r.why}`);
  }
}

async function main() {
  const DRY = flag("--dry-run");
  const APPLY = flag("--apply");
  if ([DRY, APPLY].filter(Boolean).length !== 1) {
    say("registry-backfill: pass exactly one of --dry-run or --apply\n"
      + "  --dry-run  reads the roll and the store and prints the plan; writes nothing, exits 0\n"
      + "  --apply    writes the planned rows through the ceremony's own writers, then drains\n"
      + "  --town <path>  the town checkout to read the roll from (default the office's town-clone)");
    process.exit(1);
  }

  const pins = readPins(TOWN);
  const read = readRoll(TOWN, pins);
  if (!read.carded) {
    say(`registry-backfill: no ADDRESS cards under ${join(TOWN, WHITE_PAGES)} — that is not an empty town, it is the wrong path or an un-checked-out clone, and a backfill against an empty roll plans nothing while looking like it worked`);
    process.exit(1);
  }

  // NULL IS NOT EMPTY. `loadRegistryRows` answers null for "this office is not
  // pointed at the record", and against an empty registry every account is
  // unknown and every slug is free — which would plan a duplicate house for
  // every resident in the town.
  const rows = await loadRegistryRows();
  if (rows === null) {
    say("registry-backfill: this office is not pointed at the record (WORLD2_PG=1 and WORLD2_PG_URL are what point it) — nothing was read and nothing was planned");
    process.exit(1);
  }

  const plan = planBackfill(read.roll, rows);
  printPlan(read, plan);

  if (DRY) {
    say("");
    say("registry-backfill --dry-run: nothing was written.");
    process.exit(0);
  }

  // ── --apply ───────────────────────────────────────────────────────────────

  // EMPTY IS NOT READY, and it is a different refusal from "cannot look". A
  // store with no households is a store whose seed has not run; every slug in
  // it is free, so the plan above is a plan to found the whole town.
  if (!rows.households.length) {
    say("");
    say("registry-backfill --apply: the store holds ZERO households — the seed (tools/registry-seed.mjs) has not run. "
      + "Against an empty registry every house in the roll looks new, so applying now would mint the whole town a second time. Nothing was written.");
    process.exit(1);
  }

  if (plan.refusals.length) {
    say("");
    say(`registry-backfill --apply: ${plan.refusals.length} house(s) the planner refused, listed above. Nothing was written — a partial backfill is a registry nobody can reason about.`);
    process.exit(1);
  }

  if (!plan.houses.length) {
    say("");
    say("registry-backfill --apply: nothing to write — every house in the roll already has a row.");
    process.exit(0);
  }

  // RE-CHECKED AT THE MOMENT OF WRITING. The planner checked the rows it was
  // handed; a declaration landing between that read and this write would make
  // one of these slugs taken, and `insertHousehold` is deliberately NOT an
  // upsert, so it would throw rather than overwrite. This turns the throw into
  // a sentence, before any row is written.
  const taken = new Set(rows.households.map((r) => r.slug));
  const clashes = plan.houses.filter((h) => taken.has(h.slug));
  if (clashes.length) {
    say("");
    say(`registry-backfill --apply: ${clashes.map((h) => "`" + h.slug + "`").join(", ")} ${clashes.length === 1 ? "is" : "are"} already taken in the store. Nothing was written.`);
    process.exit(1);
  }

  const wrote = { households: 0, pins: 0 };
  for (const h of plan.houses) {
    const written = await insertHousehold(rowForHouse(h));
    if (written === null) {
      say("");
      say(`registry-backfill --apply: the record went out of reach while writing \`${h.slug}\` — ${wrote.households} house(s) and ${wrote.pins} pin(s) landed before it. Re-run --dry-run: the tool is idempotent and will plan only what is left.`);
      process.exit(1);
    }
    wrote.households++;
    say(`  wrote household \`${h.slug}\` at position ${written.ord} (provisional, from ${h.provisionalFrom})`);
    for (const p of h.pins) {
      await upsertPin({ ...p, renamed: null, note: null, retired: null, renamed_to: null });
      wrote.pins++;
      say(`    pinned ${p.handle} -> @${p.login}`);
    }
  }

  const note = `POS-159 backfill: ${wrote.households} household(s) the roll held and the registry did not, each with a PROVISIONAL key taken from its first resident's handle. Each chooses its own key once, at its human's first co-sign.`;
  const d = await drainRegistry({ clone: TOWN, note });
  say("");
  say(`registry-backfill --apply: wrote ${wrote.households} household(s) and ${wrote.pins} pin(s).`);
  if (!d.ran) {
    say(`  the drain did NOT run: ${d.refused ?? d.skipped}`);
    say("  the ROWS ARE IN THE RECORD and the town's two files are one render behind. Clear it by hand (tools/registry-drain.mjs) before the next crossing.");
    process.exit(1);
  }
  say(d.changed.length
    ? `  then wrote ${d.changed.join(", ")}, commit ${d.commit ?? "(empty diff — the pen committed nothing)"}`
    : "  the files already match the store — nothing written, nothing committed");
  process.exit(0);
}

// Only run when invoked as a script — and compare REAL paths, because an entry
// reaching this file through a Windows junction makes the URL compare false and
// the tool then exits 0 having done nothing (HQ memory `junctions-defeat-main-guards`,
// this repo's `test/cli-guard.test.mjs`). A backfill that silently did nothing
// reads exactly like a backfill with nothing to do.
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();

if (isMain) main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
