#!/usr/bin/env node
// roll-ingest.mjs — the TOWN'S ROLL, derived from a town checkout.
//
// THE LAW THIS IMPLEMENTS (Keemin's ruling, 2026-08-29, on the seam
// `live-reads.mjs` DISCLOSURES.roll_source refused to guess at): the 2.0 read
// tier asks the TOWN's roll, not `identities`. The reason is #1864's, and
// `positions.mjs` states it in the sentence `positionRoster` carries verbatim:
//
//   "THE TOWN ROLL — the third term, and the one that made the union honest …
//    28 of 103 residents were not answered wrongly, they were never asked
//    about."
//
// ── THIS FILE IS NOT A PEN ───────────────────────────────────────────────────
//
// It derives; `stamp-ingest.mjs` writes. Both projections come from ONE repo at
// ONE sha and share ONE row in `projection_heads`, so two tools moving that head
// would be the two-pens class the whole schema exists to make unrepresentable:
// a head at a sha with stamps and no roll is a store that cannot say what roster
// its last clearing computed against. So `writeRoll` takes the CALLER's client
// mid-transaction, opens no transaction of its own, and touches
// `projection_heads` never. The CLI here is `--dry-run` only, and says so.
//
// ── REUSE, NOT RE-IMPLEMENTATION ─────────────────────────────────────────────
//
// The roll has exactly one definition in this office and it is two steps, both
// imported live rather than restated:
//
//   1. `readTown` (vendor/tools/lib/town.mjs) enumerates it —
//        "residents (skip TEMPLATE — it's the blank form, not a resident)"
//        `listDir(WHITE_PAGES).filter((n) => isDir(...) && n !== "TEMPLATE")`
//      — and reads each ADDRESS.md with the town's own frontmatter parser.
//
//   2. `isResidentHandle` (src/residency.mjs) admits it, and that file says why
//      the first step is not enough on its own:
//        "The vendor's enumeration skips exactly one name (`n !== "TEMPLATE"`)
//         — a NAME LIST, not a rule, which is why the second non-resident
//         directory walked straight through it and `_archived` came out of the
//         live walkers door standing on the quay."
//
// Those are the SAME two steps `residentList` (src/queries.mjs) applies to the
// office's own index, which is what `townRoll()` in server.mjs hands 1.0's
// `/world/present`. So this projection is not "a roll like the town's": it is
// the town's, derived by the town's reader under the door's own admission
// grammar. Measured on the pinned town sha `830a6996`: 140 WHITE_PAGES entries,
// 133 directories, 132 handles the door could admit — and 132 is exactly what
// the lab's 1.0 door answered with on 2026-08-28.
//
// The office's readers are imported from THIS checkout rather than from the town
// one, and that is the correct half of the reuse rule: the town repo owns its
// FRONTMATTER (and `vendor/tools/lib/town.mjs` is that reader, vendored under an explicit
// do-not-edit-here notice), while who counts as a resident AT THE DOOR is the
// office's own law and lives nowhere else.
//
// ── USAGE ────────────────────────────────────────────────────────────────────
//
//   node world2/tools/roll-ingest.mjs --town-repo <checkout> [--json]
//     — derives and prints. It cannot write; run `stamp-ingest.mjs` for that.

import { dirname, join, resolve } from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OFFICE = resolve(HERE, "..", "..");

/**
 * Every `town_roll` row for one town checkout.
 *
 * PURE with respect to the checkout and the database — the ingester and the
 * projection falsifier both call THIS, so an equality check is about the
 * database and never about two readers that fell out of step (the sibling
 * derivations' rule, `deriveStamps` and `deriveLaw`).
 *
 * Sorted by handle so two honest runs produce the same row order; the census
 * counts every stage, because "132 residents" with no denominator cannot tell a
 * reader whether the roll shrank or the reader did.
 */
export async function deriveRoll({ townRepo }) {
  const repo = resolve(townRepo);
  const { readTown } = await import(pathToFileURL(join(OFFICE, "vendor", "tools", "lib", "town.mjs")).href);
  const { isResidentHandle } = await import(pathToFileURL(join(OFFICE, "src", "residency.mjs")).href);

  const town = readTown(repo);
  const all = town.residents ?? [];
  if (!all.length) {
    throw new Error(`no WHITE_PAGES residents under ${repo} — is this a town checkout? (a roll of zero is a finding, never a projection)`);
  }
  const admitted = all.filter((r) => isResidentHandle(r.handle));
  const refused = all.filter((r) => !isResidentHandle(r.handle)).map((r) => r.handle);
  const noCard = admitted.filter((r) => !r.address).map((r) => r.handle);

  const rows = admitted
    .map((r) => ({ handle: r.handle, data: r.address?.data ?? {} }))
    .sort((a, b) => (a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0));

  return { rows, scanned: all.length, refused, no_address: noCard };
}

const CHUNK = 500;

/**
 * Replace this sha's roll. RUNS INSIDE THE CALLER'S TRANSACTION — no BEGIN, no
 * COMMIT, and no `projection_heads` write. `stamp-ingest.mjs` owns all three, so
 * the town's two projections and the head they are read at move together or not
 * at all.
 *
 * DELETE-then-INSERT for the sha, which is what makes a re-run of one sha a
 * no-op by construction — the property the merge webhook and `clearing_job`'s
 * own first-step ingest both stand on.
 */
export async function writeRoll(client, { townSha, rows }) {
  await client.query("DELETE FROM town_roll WHERE town_sha = $1", [townSha]);
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const values = [];
    const params = [];
    slice.forEach((r, n) => {
      const b = n * 2;
      values.push(`($${slice.length * 2 + 1}, $${b + 1}, $${b + 2})`);
      params.push(r.handle, JSON.stringify(r.data ?? {}));
    });
    params.push(townSha);
    await client.query(
      `INSERT INTO town_roll (town_sha, handle, data) VALUES ${values.join(", ")}`, params);
  }
}

// ── CLI — derivation only ────────────────────────────────────────────────────

const argOf = (name) => { const i = process.argv.indexOf(name); return i !== -1 ? process.argv[i + 1] : null; };

async function main() {
  const townRepo = argOf("--town-repo");
  if (!townRepo) {
    console.error("usage: roll-ingest.mjs --town-repo <checkout> [--json]\n" +
      "  derivation only — the WRITE is stamp-ingest.mjs's, because both town projections share one head");
    process.exit(2);
  }
  const { rows, scanned, refused, no_address } = await deriveRoll({ townRepo });
  const summary = { rows: rows.length, white_pages_entries: scanned, refused, no_address };
  if (process.argv.includes("--json")) { console.log(JSON.stringify(summary, null, 2)); return; }
  console.log(`town_roll: ${rows.length} handles from ${scanned} WHITE_PAGES entr${scanned === 1 ? "y" : "ies"}` +
    (refused.length ? `\n  refused by the door's admission grammar: ${refused.join(", ")}` : "") +
    (no_address.length ? `\n  ⚑ ${no_address.length} admitted handle(s) carry no ADDRESS.md: ${no_address.join(", ")}` : "") +
    `\n  (derivation only — run stamp-ingest.mjs to write it)`);
}

// ── entry guard ──────────────────────────────────────────────────────────────
// The junction lesson (2026-09-05, HQ memory `junctions-defeat-main-guards`):
// `pathToFileURL(process.argv[1]).href === import.meta.url` is FALSE when the
// entry path reaches this file through a Windows junction — the ESM loader
// realpaths the entry, argv[1] is not — so the tool exits 0 having done nothing.
// Compare real paths (world2/tools/await-clearing.mjs's idiom); the URL compare is
// only the fallback for an argv[1] that cannot be realpath'd. The office's
// test/cli-guard.test.mjs imports this file and spawns it through a junction.
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) {
  main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
}
