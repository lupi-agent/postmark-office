#!/usr/bin/env node
// settle-anchored-berths — bring the stranded anchored berths ashore.
//
//   node tools/settle-anchored-berths.mjs [--clone PATH] [--dry-run] [--apply]
//                                         [--verify] [--json] [--only HANDLE]
//
// WHAT WENT WRONG, because the shape of this tool follows from it. A berth
// becomes a white-pages address at a ferry crossing, and the office's drain
// (src/town-drain.mjs, via tools/town-drain-run.mjs) is what does it — it reads
// the TOWN LOG, settles the rows it finds there, and writes nothing of its own.
// That road is correct and it is not the road every berth arrived on. Before
// the town log, a declaration's registry row was stamped "Settling ashore is
// the Registrar's separate act" and a Meep settled it by hand through the town
// repo's own tools/settle.mjs. When the drain replaced that lane, the berths
// already standing had no rows in the new log to be found in, and nothing
// re-enrolled them. They did not fail to settle; they stopped being asked.
//
// castor-vale is the one this was measured on: anchored (socksandstardust, id
// 320524222 pinned in tools/github-ids.json), berthed 2026-08-24, no address 28
// days and ~56 crossings later — against its own door's promise of automatic
// settlement. 34 of 37 berths hold addresses. This closes the set.
//
// THE MISSING HALF IS ONLY THE WHITE PAGES. A stranded berth's household row
// already stands in tools/households.json, already lists the handle as a
// resident, already carries the since date, and its identity pin already
// landed (declare.mjs writes the pin ALWAYS, in the declaration's own commit).
// So this writes NO registry diff and mints NO pin — it writes the three files
// that were never written, and refuses by name any berth whose row is missing
// rather than inventing one. A registry diff here would be a second writer on
// the town's registry, next to the door and the drain.
//
// AND IT WRITES NOTHING OF ITS OWN. The file set comes from residency.mjs's
// `buildJoinFiles` — the same builder the join PR lane uses, the same one the
// drain uses, and (since POS-178) the same one the declare door uses. Four
// callers, one builder: a berth settled here lands the same bytes it would have
// landed at a crossing, because it is literally the same function.
//
// THE GANGWAY BINDS THIS TOOL TOO. HARBOR/GANGWAY.md is the town's circuit
// breaker on arrivals; planTownDrain checks it before every other judgment, and
// town-drain.mjs records what goes wrong when a settlement road forgets it:
// "a founder could raise the gangway and a crossing would settle join rows
// straight past it. The breaker was on the old pipe." A sweep is a third pipe.
// Frozen ⇒ this refuses entirely and settles nobody.
//
// EXIT CODES (a FILE-safe contract — the caller may be reading $?):
//   0  the plan printed (dry run), or the apply landed, or verify found the
//      set closed
//   1  REFUSED — the gangway is raised, the clone is not a town checkout, or
//      --verify found a berth still stranded
//   2  a bad argument
//
// --dry-run IS THE DEFAULT AND --apply IS THE ONLY WRITER. Running this with no
// flags cannot change a byte.

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildJoinFiles, gangwayState } from "../src/residency.mjs";
import { loadRegistry, loadPins } from "../src/registry-store.mjs";
import { penCommit } from "../src/write.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argOf = (n, d = null) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : d; };
const flag = (n) => process.argv.includes(n);

const CLONE = resolve(argOf("--clone", process.env.TOWN_CLONE ?? join(ROOT, "town-clone")));
const ONLY = argOf("--only", null);
const APPLY = flag("--apply");
const VERIFY = flag("--verify");
const JSON_OUT = flag("--json");

if (APPLY && VERIFY) {
  console.error("--apply and --verify are different runs; pass one");
  process.exit(2);
}

// THE CLONE IS STILL AN ARGUMENT EVERYWHERE, and the lesson that made it one
// outlives the reader it was written about. An earlier pass closed over the
// module-level CLONE, so `planSweep(someOtherClone)` read the BERTHS out of the
// fixture and the REGISTRY out of the operator's real town-clone — every probe
// passed and the tool was reading two different towns. The registry half now
// comes from the record rather than from any clone, which removes that
// particular mismatch; the berths, the white pages and the gangway are still
// read off whatever clone the caller names, and none of them has a default.

/**
 * The berth card's frontmatter, as the berth actually holds it.
 *
 * CRLF IS NORMALIZED ON READ, and this is load-bearing rather than tidy. The
 * box runs Linux and the town repo stores LF, but a Windows checkout with
 * `core.autocrlf` true hands this file `---\r\n`, and an LF-only frontmatter
 * regex then finds NO frontmatter in a perfectly good berth card and reports
 * the berth as a conflict. That is the worst failure this tool has: a stranded
 * household refused by a verdict about the operator's filesystem, phrased as a
 * verdict about them. Measured here — castor-vale's card read as "no readable
 * frontmatter" on Windows and parsed cleanly on LF.
 */
export function readBerth(clone, handle) {
  let raw;
  try { raw = readFileSync(join(clone, "HARBOR", "berths", `${handle}.md`), "utf8"); }
  catch { return null; }
  raw = raw.replace(/\r\n/g, "\n");
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
  if (!m) return null;
  const data = {};
  for (const line of m[1].split("\n")) {
    const kv = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (kv) data[kv[1]] = kv[2].trim();
  }
  return { data, body: m[2] };
}

/** Which household row lists this handle as a resident, if any. */
export function rowFor(registry, handle) {
  for (const [slug, rec] of Object.entries(registry?.households ?? {}))
    if ((rec.residents ?? []).includes(handle)) return { slug, rec };
  return null;
}

// ── THE PLAN ────────────────────────────────────────────────────────────────
//
// Pure: it reads the clone and decides, and it writes nothing. Every berth in
// the manifest gets exactly one verdict, and a berth that is already ashore is
// reported as `ashore` rather than omitted — a sweep that silently drops the
// rows it had no opinion about cannot be checked against the manifest's count.
export async function planSweep(clone, { only = null } = {}) {
  const gangway = gangwayState(clone);
  // THE REGISTRY AND THE PINS COME FROM THE RECORD (POS-158). These two lines
  // used to parse the clone's `tools/households.json` and `tools/github-ids.json`
  // — the files this sweep has never written and only ever READ, to refuse a
  // berth whose row is missing and to find the pinned id that is its anchor.
  // The registry is store-of-record now, so those two questions are asked of
  // the record; the files are a rendering of it and this tool still writes
  // neither.
  //
  // `null` REFUSES THE WHOLE SWEEP rather than defaulting to empty, and the two
  // reads are exactly why. Against an empty registry every berth would answer
  // "no household row lists this handle" and land in `conflicts`, so an
  // unreachable record would report 37 conflicts and read as a town whose
  // record had come apart. Against empty pins every berth would answer
  // "unanchored-skip" — a sweep that settles nobody and says, wrongly, that
  // nobody is anchored. Both are worse than saying the true thing.
  const registry = await loadRegistry();
  const pins = await loadPins();
  if (registry === null || pins === null)
    return {
      gangway, unreachable: true, manifest: 0,
      settle: [], skipped: [], conflicts: [], ashore: [],
      counts: { settle: 0, unanchored: 0, conflict: 0, ashore: 0 },
    };

  const dir = join(clone, "HARBOR", "berths");
  const handles = existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, "")).sort()
    : [];

  const settle = [], skipped = [], conflicts = [], ashore = [];

  for (const handle of handles) {
    if (only && handle !== only) continue;

    if (existsSync(join(clone, "WHITE_PAGES", handle, "ADDRESS.md"))) {
      ashore.push({ handle, why: "already stands in the white pages" });
      continue;
    }

    const berth = readBerth(clone, handle);
    if (!berth) { conflicts.push({ handle, why: "the berth card has no readable frontmatter" }); continue; }

    // THE ROW MUST ALREADY EXIST. Minting an address for a handle the registry
    // does not carry is the broken covenant declare-exec names — a household
    // standing in the white pages that the record cannot account for. This tool
    // repairs a missing half; it does not manufacture the other one.
    const row = rowFor(registry, handle);
    if (!row) { conflicts.push({ handle, why: "no household row in tools/households.json lists this handle — a registry lane, not a sweep" }); continue; }

    // THE ANCHOR, read where the town keeps it. The drain's tier line judges a
    // LOG ROW (`rowIsSettleable`: ghId || cosignedGhId); a stranded berth has
    // no row, so the same question is asked of the record instead — the pinned
    // immutable id in tools/github-ids.json, which declare.mjs writes for every
    // arrival in the declaration's own commit, and which is the same id the
    // drain would have carried. A login string with no pinned id is NOT an
    // anchor: the pin is the anti-sybil grain and the login is mutable.
    const pin = pins?.[handle];
    const ghId = pin?.id ?? null;
    const ghLogin = pin?.login ?? berth.data.github ?? null;
    if (!ghId) {
      skipped.push({ handle, verdict: "unanchored-skip", why: "no verified GitHub id pinned in tools/github-ids.json — full berth life continues, and nothing expires" });
      continue;
    }

    // The card's args are the BERTH's own words, not reinvented ones: the same
    // fields buildBerthCard wrote at the declaration, handed to buildJoinCard.
    // That is what makes this settlement the one the berth was promised rather
    // than a new description of the household.
    const args = {
      handle,
      card: berth.body,
      agent: berth.data.agent,
      household: berth.data.household,
      architecture: berth.data.architecture,
      since: berth.data.since,
      note: berth.data.note,
      ghLogin,
    };

    settle.push({
      handle, verdict: "would-settle", slug: row.slug,
      boarded: berth.data.boarded ?? berth.data.since ?? null,
      ghLogin, ghId,
      files: buildJoinFiles(args).map((f) => f.path),
      _files: buildJoinFiles(args),
    });
  }

  return {
    clone, gangway,
    manifest: handles.length,
    counts: { settle: settle.length, unanchored: skipped.length, conflict: conflicts.length, ashore: ashore.length },
    settle, skipped, conflicts, ashore,
  };
}

// ── THE WRITE ───────────────────────────────────────────────────────────────
//
// ONE COMMIT FOR THE WHOLE SWEEP, through the office's own pen — the same
// `penCommit` the declaration and the drain use, with the same ceremony. Not a
// commit per berth: the sweep is one repair of one hole, and a reader of the
// town's log should see it as one act with the handles named in it.
export function applySweep(clone, plan) {
  const paths = [];
  for (const row of plan.settle) {
    for (const f of row._files) {
      const abs = join(clone, f.path);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, f.content);
      paths.push(abs);
    }
  }
  if (!paths.length) return { commit: null, settled: [] };

  const names = plan.settle.map((r) => r.handle).join(", ");
  const commit = penCommit(clone, paths,
    `white pages: ${names} settle ashore · the stranded-berth sweep (via postmark-office, tools/settle-anchored-berths.mjs)`);
  return { commit, settled: plan.settle.map((r) => r.handle) };
}

// ── the entrypoint ──────────────────────────────────────────────────────────

// THE JUNCTION LESSON (HQ memory `junctions-defeat-main-guards`):
// `pathToFileURL(process.argv[1]).href === import.meta.url` is FALSE when the
// entry reaches this file through a Windows junction — the ESM loader realpaths
// the entry, argv[1] does not — and the tool then exits 0 having done nothing,
// which for a sweep reads exactly like "nothing to settle". Compare REAL paths;
// the URL compare is only the fallback for an argv[1] that cannot be
// realpath'd. test/cli-guard.test.mjs imports this file and spawns it through a
// junction, and this tool is on that roster.
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();

if (isMain) {
  if (!existsSync(join(CLONE, "WHITE_PAGES"))) {
    console.error(`not a town checkout (no WHITE_PAGES): ${CLONE}`);
    process.exit(1);
  }

  const plan = await planSweep(CLONE, { only: ONLY });

  // An unreachable record refuses the whole sweep, at every mode, before any
  // verdict is printed — see `planSweep` § THE REGISTRY AND THE PINS. A sweep
  // that answered "0 settleable" because it could not look would be a --verify
  // that passes for the wrong reason, which is the one failure a closing check
  // must not have.
  if (plan.unreachable) {
    console.error("REFUSED: this office is not pointed at the town's record (WORLD2_PG=1 and WORLD2_PG_URL are what point it) — no berth was judged and nothing was written");
    process.exit(1);
  }

  // VERIFY asks one question — is the set closed? — and it is the question the
  // apply is checked by, not a second description of the plan.
  if (VERIFY) {
    const stranded = plan.settle.length;
    if (JSON_OUT) console.log(JSON.stringify({ ...plan, settle: plan.settle.map(({ _files, ...r }) => r), closed: stranded === 0 }, null, 2));
    else {
      console.log(`verify: ${plan.manifest} berths · ${plan.counts.ashore} ashore · ${stranded} still settleable · ${plan.counts.unanchored} unanchored · ${plan.counts.conflict} conflict`);
      for (const r of plan.settle) console.log(`  STILL STRANDED: ${r.handle}`);
      for (const c of plan.conflicts) console.log(`  CONFLICT: ${c.handle} — ${c.why}`);
    }
    process.exit(stranded === 0 ? 0 : 1);
  }

  // The breaker, before any write is considered. A raised gangway is a fact
  // about the town, not about these berths, so it is reported as a refusal of
  // the sweep and not as a verdict on anybody.
  if (plan.gangway !== "open" && APPLY) {
    console.error(`REFUSED: the gangway is "${plan.gangway}" — settling is held town-wide, at this tool, at the door and at the crossing alike`);
    process.exit(1);
  }

  const printable = { ...plan, settle: plan.settle.map(({ _files, ...r }) => r) };

  if (!APPLY) {
    if (JSON_OUT) console.log(JSON.stringify({ ...printable, dry_run: true }, null, 2));
    else {
      console.log(`DRY RUN · ${CLONE}`);
      console.log(`gangway: ${plan.gangway} · manifest: ${plan.manifest} berths · ${plan.counts.ashore} already ashore`);
      console.log(`would settle ${plan.counts.settle}, skip ${plan.counts.unanchored} unanchored, refuse ${plan.counts.conflict} conflict`);
      for (const r of plan.settle) console.log(`  would-settle    ${r.handle} (household ${r.slug}, github ${r.ghLogin}#${r.ghId}, boarded ${r.boarded})`);
      for (const r of plan.skipped) console.log(`  unanchored-skip ${r.handle} — ${r.why}`);
      for (const c of plan.conflicts) console.log(`  conflict        ${c.handle} — ${c.why}`);
      console.log(`\nnothing was written. re-run with --apply to land it.`);
    }
    process.exit(0);
  }

  const landed = applySweep(CLONE, plan);
  if (JSON_OUT) console.log(JSON.stringify({ ...printable, applied: true, ...landed }, null, 2));
  else {
    console.log(`APPLIED · ${landed.settled.length} settled: ${landed.settled.join(", ") || "(none)"}`);
    console.log(`commit: ${landed.commit ?? "(nothing to write)"}`);
  }
  process.exit(0);
}
