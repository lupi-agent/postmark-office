// arena-closed.test.mjs — the arena is closed (Keemin, 2026-09-30: "the arena is
// not live; it will be reimplemented properly later, and nothing should be
// ported").
//
//   the refusal     every arena verb answers "the arena is closed", in the
//                   apex's error grammar (code, defect, hint), pinned word for word
//   no store        the arena's door touches neither dynamic.db nor world.db:
//                   it imports nothing, and driving it with both stores pointed
//                   at paths that do not exist leaves both paths absent
//   nothing left    the fold, the wheel, the portal block, the loot shroud, the
//                   walk's ground lookup and the arena's journal writer are gone
//                   from src, by name
//
// The apex's own door (`do: strike`, `do: loot`) is driven in world-apex.test.mjs,
// where the store harness lives.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SRC = join(import.meta.dirname, "..", "src");

test("THE REFUSAL: every arena verb answers \"the arena is closed\" (501, the apex's grammar), and neither store is touched", async () => {
  const dir = mkdtempSync(join(tmpdir(), "arena-closed-"));
  const was = { dyn: process.env.WORLD_DYNAMIC_DB, world: process.env.WORLD_STORE_DB };
  const dyn = join(dir, "nothing", "dynamic.db"), world = join(dir, "nothing", "world.db");
  process.env.WORLD_DYNAMIC_DB = dyn;
  process.env.WORLD_STORE_DB = world;
  try {
    const { ARENA_VERBS, ARENA_CLOSED, ARENA_CLOSED_HINT, arenaActViaOffice } = await import("../src/arena.mjs");
    assert.deepEqual([...ARENA_VERBS], ["strike", "cast", "guard", "lift", "loot"]);
    assert.equal(ARENA_CLOSED, "the arena is closed");
    for (const verb of ARENA_VERBS) {
      await assert.rejects(arenaActViaOffice(dir, { __action: verb, object: "anyone" }, { handles: new Set(["wright"]) }, {}),
        (e) => e.code === 501 && e.defect === "the arena is closed" && e.message === "the arena is closed"
          && e.hint === ARENA_CLOSED_HINT && e.action === verb,
        `${verb} did not answer the closed arena's refusal`);
    }
    assert.equal(existsSync(dyn), false, "an arena door created dynamic.db");
    assert.equal(existsSync(world), false, "an arena door created world.db");
    assert.equal(existsSync(join(dir, "nothing")), false, "an arena door made the stores' directory");
  } finally {
    for (const [k, v] of [["WORLD_DYNAMIC_DB", was.dyn], ["WORLD_STORE_DB", was.world]]) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("NO STORE, BY CONSTRUCTION: arena.mjs imports nothing and names no store opener or query", () => {
  const code = readFileSync(join(SRC, "arena.mjs"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  assert.deepEqual(code.match(/^\s*import\b.*$/gm) ?? [], [], "the closed arena imports a module — a door with an import can open a store");
  assert.deepEqual(code.match(/\bimport\(/g) ?? [], [], "the closed arena imports a module lazily");
  for (const word of ["DatabaseSync", "openDynamic", "openStore", "prepare(", "SELECT", "INSERT", "readJournal"])
    assert.equal(code.includes(word), false, `arena.mjs names ${word}`);
});

test("NOTHING LEFT OF THE FIGHT: the fold, the wheel, the adversary, the encounter on the read, the shroud and the journal writer are gone from src", () => {
  assert.equal(existsSync(join(SRC, "encounter.mjs")), false, "the encounter fold is back");
  // The portal ground's own law is NOT on this list, and must not be: the
  // ground lookup, its stride, its spawn and `standpoint.portal` outlived the
  // arena (src/portal-ground.mjs; the rooms are walked with no fight in them).
  const gone = ["encounterOn", "arenaGroundAt", "arrivalOnGround", "entryPointInto", "adversaryIn", "joinOnCrossing", "leaveOnCrossing",
    "portalBlockAt", "withLoose", "actingBlocked", "cockpitEncounter", "lootHiddenReason", "lootShroudedIn",
    "refuseShroudedLoot", "weaponInHand", "wheelOnCrossing", "appendArenaRow", "foldEncounter"];
  const hits = [];
  for (const f of readdirSync(SRC).filter((n) => n.endsWith(".mjs"))) {
    const code = readFileSync(join(SRC, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const name of gone) if (new RegExp(`\\b${name}\\b`).test(code)) hits.push(`${f}: ${name}`);
  }
  assert.deepEqual(hits, [], "the arena's machinery is still named in code");
  // `phaseAt` is a common name (events and posts have their own); the arena's was the apex's.
  assert.equal(/phaseAt/.test(readFileSync(join(SRC, "world-apex.mjs"), "utf8")), false, "the apex reads an encounter's phase again");
});
