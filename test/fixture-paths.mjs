// fixture-paths.mjs — where the town and the world checkouts are, on ANY machine.
//
// THE DEFECT THIS EXISTS FOR (postmark#2980 / POS-131, measured 2026-09-19/21):
// suites resolved their fixture checkout by naming an absolute path on one
// operator's disk — `G:/postmark/seam-overnight/town-clone`, `G:/Wright-HQ/postmark`,
// `G:/Postmark/repo-clones/wright/postmark-world`, and a `process.cwd()/../postmark-world`
// that means a different directory in every tree. A fresh pool tree therefore
// opened dozens of reds that said nothing whatever about the office, and the
// reds that WERE about the office sat inside that noise.
//
// THIS IS NOT A NEW IDIOM. Five suites already carried the right one — office
// a59976f, "fallback paths follow", and `next-steps.test.mjs`'s list. This is
// that idiom written once instead of twenty-eight times, each drifting.
//
// THE ORDER IS THE OFFICE'S OWN, deliberately: `src/households.mjs` for the
// town (`TOWN_CLONE` env, else `<office>/town-clone`) and
// `src/world-store.mjs § WORLD_CLONE` for the world (`WORLD_CLONE` env, else
// `<office>/world-clone`, else the sibling `<office>/../postmark-world`). A
// suite that resolved its checkout differently from the code it tests could be
// pointed at one town while the office read another, and every answer would
// look plausible.
//
// THE ONE DIFFERENCE FROM `src/`: these answer `null` when there is no
// checkout, where src answers a path that does not exist. A test needs that
// difference. "No clone" is a SKIP WITH ITS REASON PRINTED, not a red, and
// never a path onto a machine that is not this one — a suite that reds because
// another operator's disk is missing has measured the disk, not the office.
//
// WHAT THIS DOES NOT DO: it does not check that the directory is the RIGHT
// checkout. Each suite keeps its own marker test (`quest-registry.json`,
// `tools/quest-progress.mjs`, `WORLD/world-state.json`, `tools/enter-exit.mjs`),
// because the marker is part of what that suite is asserting and belongs with
// its assertions, not here.

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The office checkout this test file lives in. */
export const OFFICE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// An env var EXPORTED EMPTY is not an env var set. `TOWN_CLONE=` in a shell, or
// a CI matrix leg that leaves a variable blank, is a variable that is present
// and says nothing; reading `""` as a path makes every suite red on a directory
// called "".
const env = (name) => {
  const v = process.env[name];
  return v && v.trim() ? v : null;
};

// A rung counts only if it is THERE. That includes the env var: a `TOWN_CLONE`
// pointing at a directory nobody has is not a checkout, it is a typo — and two
// things follow, both deliberate.
//
//   · The typo must not be silent, so the skip REASON names the variable and
//     the path it named, rather than the generic "no clone". A skip whose
//     reason does not distinguish "you have no clone" from "you told me the
//     wrong place" is a skip that reads as normal on a CI leg that is broken.
//   · The no-clone arm becomes DRIVABLE on a machine that has a clone —
//     `TOWN_CLONE=/no/such/place` reaches it. Without that, the skip branches
//     every suite below now depends on could not be exercised anywhere they
//     were written, and a guard nothing can drive is a guard nobody checked.
const resolveClone = (name, ...rungs) => {
  const named = env(name);
  if (named) {
    if (existsSync(named)) return { path: named, why: null };
    return { path: null, why: `${name} is set to ${named}, and there is no such directory` };
  }
  const found = rungs.find((p) => p && existsSync(p));
  if (found) return { path: found, why: null };
  return { path: null, why: `no checkout — set ${name}, or put one at ${rungs[0]}` };
};

const TOWN = resolveClone("TOWN_CLONE", join(OFFICE_ROOT, "town-clone"));
const WORLD = resolveClone("WORLD_CLONE",
  join(OFFICE_ROOT, "world-clone"), join(OFFICE_ROOT, "..", "postmark-world"));

/** The reasons, as printed. A skip with no reason is a skip nobody can act on. */
export const NO_TOWN = TOWN.why && `no town clone: ${TOWN.why}`;
export const NO_WORLD = WORLD.why && `no world clone: ${WORLD.why}`;

/** The town checkout, or `null`. */
export function townClone() {
  return TOWN.path;
}

/**
 * The world checkout, or `null`. The sibling `../postmark-world` is the third
 * rung only because `src/world-store.mjs` has it: dropping it here would let
 * the office serve from a clone the suites refuse to see.
 */
export function worldClone() {
  return WORLD.path;
}

// ── importing the town's and the world's own modules ────────────────────────
//
// These answer `null` when there is no checkout, for the same reason the
// resolvers do, and because a `join(null, …)` throws a TypeError that reads
// like a bug in the suite rather than a missing clone. A top-level
// `await import()` of a module that is not there takes the WHOLE file down at
// load: its cases then neither pass nor fail, they disappear, and the counts
// read identical before and after a change the suite never saw. So the import
// is guarded and the reason is printed by the skip.

/** A `file://` URL under the town checkout, or `null`. */
export const townModuleUrl = (...parts) => {
  const root = townClone();
  return root ? pathToFileURL(join(root, ...parts)).href : null;
};

/** A `file://` URL under the world checkout, or `null`. */
export const worldModuleUrl = (...parts) => {
  const root = worldClone();
  return root ? pathToFileURL(join(root, ...parts)).href : null;
};
