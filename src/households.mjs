// households.mjs — the household block for identity-shaped responses.
//
// Ruling 2026-08-07 (1 human = 1 household): wherever a surface answers "who
// are you" or "stamps associated with you", HOUSEHOLD is the primary column
// over resident. This module is the office's one resolver for that block —
// it imports the town's OWN vocabulary (stamp-mint currentHouseholds(): the
// from-genesis base + the ledger's dated registry: lines) and the declared
// registry (tools/households.json), and never invents a second answer
// (ruling 9: never a second resolver).
//
// Shape, per handle:
//   { key,                    the economy's current household key (hh:/gh:/login:/solo:)
//     slug,                   declared household slug, null if undeclared
//     human,                  declared human-facing name, null if undeclared
//     residents }             every handle sharing the key (siblings incl. self)
//
// Sync by design — identity reads sit in sync routes — so the town engine is
// imported once at module load (top-level await), and the fold is cached on
// (ledger mtime, households.json mtime, pins mtime): the resolver parses the
// full stamp ledger, and identity reads are frequent.

import { statSync, readFileSync } from "node:fs";

import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolveHouse } from "./household-deriver.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOWN_CLONE = process.env.TOWN_CLONE ?? resolve(HERE, "..", "town-clone");

// Guarded: with no town clone (test fixtures, a bare checkout) the module must
// load anyway and householdOf must answer null — the block is garnish, and a
// missing engine at import time took 73 tests down before this guard existed.
const { currentHouseholds } = await (async () => {
  try { return await import(pathToFileURL(join(TOWN_CLONE, "tools", "stamp-mint.mjs"))); }
  catch (e) { console.warn("households: engine import failed:", e?.message); return { currentHouseholds: null }; }
})();

let cache = null; // { stamp, byHandle: Map<handle, block> }

function stampOf() {
  const mt = (p) => { try { return statSync(join(TOWN_CLONE, p)).mtimeMs; } catch { return 0; } };
  return [mt("WHITE_PAGES/stamp-ledger.md"), mt("tools/households.json"), mt("tools/github-ids.json")].join("|");
}

function build() {
  const map = currentHouseholds(TOWN_CLONE); // handle -> { key, provisional }
  let declared = {};
  try { declared = JSON.parse(readFileSync(join(TOWN_CLONE, "tools", "households.json"), "utf8")).households ?? {}; } catch { /* registry optional */ }
  // An entry answers to every key form its house can wear: the hh: key (post
  // ledger re-key), each account's gh: key (the common case — one shared
  // credential), the login: fallback, and — since POS-160 — a FORMER or
  // provisional slug, through the one alias mechanism. The 2026-08-08 harvest
  // declared eleven existing gh:-keyed houses; their nameplates must not wait
  // on a ledger ceremony the economy doesn't need.
  //
  // THE WALK IS THE DERIVER'S (POS-160). This used to build its own key -> slug
  // map, which was a fourth answer to "which house" and the only one that could
  // not see `formerly` — so a house that re-keyed through the choose-once path
  // lost its nameplate on every surface this module feeds, silently, for as
  // long as a stale key was in play. Same question, same walk, one place.
  //
  // It stays SYNCHRONOUS and it stays on the town clone's file. Identity reads
  // sit in sync routes, the deriver's loaded half is a store read, and the
  // pure core takes the registry as an argument precisely so this caller can
  // hand it one it already has. What moved here is the derivation; what did
  // not move is where this module gets its bytes.
  const byKey = new Map(); // key -> [handles]
  for (const [handle, rec] of map) {
    if (!byKey.has(rec.key)) byKey.set(rec.key, []);
    byKey.get(rec.key).push(handle);
  }
  const byHandle = new Map();
  for (const [handle, rec] of map) {
    const slug = resolveHouse(rec.key, { households: declared }).slug;
    byHandle.set(handle, {
      key: rec.key,
      slug,
      human: slug ? declared[slug]?.human ?? null : null,
      residents: byKey.get(rec.key).slice().sort(),
    });
  }
  return byHandle;
}

/**
 * The household's HUMAN, as the town's record names them.
 *
 * ONE DERIVATION, TWO CALLERS. `worldSayHuman` has owned this label since
 * 2026-08-08 — `human-of-<household slug>`, the town's declared slug when the
 * registry has one and the first handle otherwise, "NEVER the GitHub login
 * (the office does not name people)". The apex now needs the SAME name, because
 * an embodied act has to be handed the hand it is recorded under, and a second
 * derivation there would be a second answer to a settled question — the drift
 * the quote law exists to kill. So the derivation moved here, where household
 * identity already lives, and both doors read it.
 *
 * The prefix is reserved town-wide on purpose: `residency.mjs` and
 * `declare.mjs` each refuse a resident handle wearing it, precisely so this
 * label can never collide with somebody's own voice.
 *
 * Null when there is no handle to name a household after — never a guessed
 * default, for the same reason `humanTokenUrl` returns null rather than
 * somebody else's face.
 */
export function humanHandFor(handles = []) {
  const list = [...handles].filter(Boolean).map(String);
  if (!list.length) return null;
  let slug = null;
  for (const h of list) {
    try { const hh = householdOf(h); if (hh?.slug) { slug = hh.slug; break; } } catch { /* garnish only */ }
  }
  return `human-of-${slug ?? list[0]}`;
}

let warned = false;
export function householdOf(handle) {
  if (!currentHouseholds) return null; // no engine at this checkout — garnish stays absent
  try {
    const stamp = stampOf();
    if (!cache || cache.stamp !== stamp) cache = { stamp, byHandle: build() };
    return cache.byHandle.get(handle) ?? null;
  } catch (e) {
    if (!warned) { warned = true; console.warn("households: resolve failed:", e?.message); }
    return null;
  }
}
