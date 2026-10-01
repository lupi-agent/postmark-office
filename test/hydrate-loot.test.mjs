// hydrate-loot.test.mjs — THE PIPE THE LOOT FLAG DIED IN.
//
//   node --test test/hydrate-loot.test.mjs
//
// LOGOS/classes.md § The portal ground, verbatim (founder-ruled 2026-08-29):
//
//   "A thing whose mark declares `loot` is NEITHER VISIBLE NOR TAKEABLE while
//    the encounter on its ground is afoot: it is absent from that ground's loose
//    things, absent from what a standpoint says stands nearby, and a `take` or a
//    `give` aimed at it is refused with a sentence that explains itself rather
//    than a bounce that reads like a fault. At `spent` it appears."
//
// ── WHY THIS FILE EXISTS, AND IT IS NOT THAT THE LAW WAS WRONG ──────────────
//
// The shroud shipped with seven falsifiers and eight flips, all green, all red
// on cue. Every one of them wrote `props` DIRECTLY into an in-memory store —
// which is the right shape for testing what the READER does with a flag, and it
// is precisely the shape that cannot see whether the flag ever arrives.
//
// It did not. `src/world-hydrate.mjs` carries an EXPLICIT field list into props,
// and `loot` was never on it: the dev stage's the-wick-end and
// a-slice-to-take-home have carried `loot: true` in their frontmatter since they
// were written, and after a fresh hydrate their rows read `props.loot = NULL`.
// So `looseIn` would have found no loot anywhere in the town and the shroud
// would have hidden nothing, live, while the suite stayed green. Found on the
// box by Wright, not by me.
//
// This is the second instance of one defect in one file — the hydrator dropped
// `dials:` the same way, and its own comment there says what it cost: "the
// running office kept its own copy of every constant." A fixture that writes the
// shape the code expects proves only that they agree with each other; the arena
// suite carries that sentence about a QUERY, and this file is it about a PIPE.
//
// So: a real mark FILE, through the REAL hydrator, into a REAL store, and the
// assertion is on the row. Nothing here writes props.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { writeFixtureDb } from "./helpers/world-rows.mjs";

import { WORLD_CLONE } from "../src/world-store.mjs";

const OFFICE = resolve(fileURLToPath(new URL("..", import.meta.url)));
const HAVE_WORLD = existsSync(join(WORLD_CLONE, "tools", "marks-fold.mjs"));

const gitq = (dir, args) => execFileSync("git", ["-C", dir, ...args], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
});

/**
 * A world fixture in two commits — the hydrator refuses a history it cannot
 * walk. Same shape as containment-map.test.mjs's, trimmed to what a thing needs.
 *
 * ⚑ THE FRONTMATTER IS WRITTEN AS A FILE, NOT AS AN OBJECT, and that is the
 * whole apparatus. The world's own parser (`marks-fold.mjs § parseRecord`)
 * coerces objects, arrays and numbers and has NO boolean case, so `loot: true`
 * on this line reaches the hydrator as the STRING "true" — which is the live
 * shape on the dev stage and the one a hand-built fixture would never produce.
 */
function buildWorld() {
  const dir = mkdtempSync(join(tmpdir(), "pm-loot-"));
  cpSync(join(WORLD_CLONE, "tools"), join(dir, "tools"), { recursive: true });

  const mark = (rel, front, body) => {
    mkdirSync(join(dir, "WORLD", "marks", rel), { recursive: true });
    writeFileSync(join(dir, "WORLD", "marks", rel, "mark.md"), `---\n${front}\n---\n\n${body}\n`);
  };

  mark("let-there-be-light",
    "kind: sited\nby: the-town\ntier: constitution\ndate: 2026-07-22\nat: { x: 0, y: 0 }\nextent: { w: 320000, h: 320000 }\ncoords: relative",
    "Let there be light.");
  gitq(dir, ["init", "-q", "."]);
  gitq(dir, ["add", "-A"]);
  gitq(dir, ["commit", "-qm", "the tree as the freeze left it"]);

  // THE PRIZE — exactly as the-wick-end carries it.
  mark("the-town/a-burnt-wick-end",
    "kind: sited\nby: the-town\ntier: market\ndate: 2026-08-29\nat: { x: 10, y: 10 }\nextent: { w: 0.1, h: 0.1 }\nclass: thing\nloot: true",
    "One burnt wick end, saved.");
  // THE WEAPON — a thing on the same floor that is NOT loot. Without it, a
  // hydrator that stamped `loot: true` on every thing would pass.
  mark("the-town/a-brass-lighter",
    "kind: sited\nby: the-town\ntier: market\ndate: 2026-08-29\nat: { x: 11, y: 10 }\nextent: { w: 0.2, h: 0.2 }\nclass: thing",
    "A brass lighter with somebody else's initials worn off it.");
  // A MISSPELLING — the shape the law refuses, which must be REPORTED rather
  // than quietly honoured or quietly dropped (the `ambient:` precedent).
  mark("the-town/a-doubtful-prize",
    "kind: sited\nby: the-town\ntier: market\ndate: 2026-08-29\nat: { x: 12, y: 10 }\nextent: { w: 0.1, h: 0.1 }\nclass: thing\nloot: yes",
    "A thing whose author believed they had hidden it.");
  gitq(dir, ["add", "-A"]);
  gitq(dir, ["commit", "-qm", "a prize, a weapon, and a misspelling"]);
  return dir;
}

function hydrate(worldDir) {
  const dbPath = join(worldDir, "world.db");
  const r = spawnSync(process.execPath,
    [join(OFFICE, "src", "world-hydrate.mjs"), "--world", worldDir, "--no-db", "--rows-out", `${dbPath}.rows.json`, "--office", OFFICE, "--no-lints", "--no-gexf"],
    { encoding: "utf8" });
  if (r.status !== 0) assert.fail(`hydration exited ${r.status}\n${r.stdout}\n${r.stderr}`);
  // The hydration emits ROWS (POS-270 lane W 3a); the file asked here is this
  // test's own, built from them, never one the office writes or opens.
  writeFixtureDb(`${dbPath}.rows.json`, dbPath);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const rows = Object.fromEntries(db.prepare(
    `SELECT id,
            json_extract(props,'$.loot')                  AS loot,
            json_type(props,'$.loot')                     AS loot_type,
            json_extract(props,'$.frontmatter_problems')  AS problems
       FROM nodes WHERE kind = 'mark'`).all().map((x) => [x.id, x]));
  db.close();
  return rows;
}

test("a mark FILE saying `loot: true` reaches the store as a real boolean",
  { timeout: 180_000 }, (t) => {
    if (!HAVE_WORLD) return t.skip(`no world clone at ${WORLD_CLONE}`);
    const dir = buildWorld();
    try {
      const rows = hydrate(dir);

      const wick = rows["the-town/a-burnt-wick-end"];
      assert.ok(wick, "the prize did not hydrate at all — this test would prove nothing");
      assert.equal(wick.loot, 1,
        "a mark file's `loot: true` did not reach the store — this is the pipe the flag died in, and `looseIn` reads NULL for every thing in the town while the shroud hides nothing");
      assert.equal(wick.loot_type, "true",
        "the flag arrived as something other than a real boolean — `isLoot` tolerates 1/true/\"true\", but the store's own JSON type is what a SQL reader would gate on, and a string there is a trap for the next query");

      // THE DISCRIMINATING LEG: an ordinary thing on the same floor is untouched.
      // Without it, stamping every thing as loot would pass everything above —
      // and the good lighter would vanish from the fight it is meant to be
      // fought with.
      const lighter = rows["the-town/a-brass-lighter"];
      assert.ok(lighter, "the weapon did not hydrate");
      assert.equal(lighter.loot, null,
        "a thing that never declared `loot` came back flagged — a weapon is loose WITHOUT being loot, and this would shroud the fight's own tool");

      // THE MISSPELLING IS REPORTED, not honoured and not silently dropped —
      // the `ambient:` precedent, and the reason it exists: an author who
      // believed they had held a prize back and has not is a disagreement
      // `frontmatter_problems` is there to surface.
      const doubtful = rows["the-town/a-doubtful-prize"];
      assert.ok(doubtful, "the misspelled mark did not hydrate");
      assert.equal(doubtful.loot, null, "`loot: yes` was honoured — the one spelling that means it is the boolean");
      assert.match(String(doubtful.problems ?? ""), /loot/,
        "`loot: yes` was dropped in silence — an author who thinks they hid a prize and did not must be told");
    } finally { try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows holds it a beat */ } }
  });
