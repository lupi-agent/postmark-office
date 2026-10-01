// dynamic-retired.test.mjs — dynamic.db, retired on the record's flags (POS-269, option B).
//
// On WORLD_POSITIONS=1 with the say and hold lanes flipped and the guards on —
// prod's flags, measured 2026-09-30 — every thing dynamic.db held is the record's:
// positions and the vessel's line (the position projection), speech (the say
// acts), holdings (the hold acts). So there the opener REFUSES by name, and the
// three paths that still opened it on those flags (the crossing-save, the
// /world/dynamic panel, the read worker's boot guard) no longer do.
//
//   node --test test/dynamic-retired.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import { dynamicRetired, openDynamic, openDynamicReadOnly, DynamicRetiredError, dynamicHealth, RETIRED_LEGACY_READERS } from "../src/dynamic-store.mjs";
import { laneFlipped } from "../src/world2-pen.mjs";
import { holdEdgeOnActs } from "../src/hold-edge.mjs";

const ROOT = join(import.meta.dirname, "..");
const PROD = { WORLD_POSITIONS: "1", WORLD2_PG: "1", WORLD2_PG_URL: "postgres://nobody@127.0.0.1:1/none", W2_PEN: "stance,hold,say,walk,frame,mark", W2_GUARDS: "1" };

/** Run `fn` with exactly these keys set (and the named ones unset), restoring after. */
async function withEnv(vars, fn) {
  const keys = [...new Set([...Object.keys(PROD), "WORLD_DYNAMIC_DB", ...Object.keys(vars)])];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) { if (vars[k] == null) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return await fn(); }
  finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

test("THE PREDICATE is laneFlipped(say) ∧ holdEdgeOnActs() ∧ WORLD_POSITIONS=1, over every combination", () => {
  const axes = {
    WORLD_POSITIONS: [undefined, "1"], WORLD2_PG: [undefined, "1"], WORLD2_PG_URL: [undefined, "postgres://x"],
    W2_PEN: [undefined, "say", "hold", "say,hold", "stance,hold,say,walk,frame,mark", "all"], W2_GUARDS: [undefined, "1"],
  };
  let combos = [{}];
  for (const [k, vals] of Object.entries(axes)) combos = combos.flatMap((c) => vals.map((v) => ({ ...c, [k]: v })));
  let yes = 0;
  for (const env of combos) {
    const clean = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined));
    const want = clean.WORLD_POSITIONS === "1" && laneFlipped("say", clean) && holdEdgeOnActs(clean);
    assert.equal(dynamicRetired(clean), want, JSON.stringify(clean));
    if (want) yes++;
  }
  assert.ok(yes > 0 && yes < combos.length, "both answers occur, so the equality is not vacuous");
  assert.equal(dynamicRetired(PROD), true, "prod's flags retire the store");
});

test("THE OPENER REFUSES BY NAME on those flags, and creates no file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dyn-retired-"));
  const path = join(dir, "dynamic.db");
  try {
    await withEnv({ ...PROD, WORLD_DYNAMIC_DB: path }, async () => {
      assert.throws(() => openDynamic(path), (e) => e instanceof DynamicRetiredError && /dynamic\.db is retired on this office's flags/.test(e.message) && e.code === 503);
      assert.throws(() => openDynamicReadOnly(path), DynamicRetiredError, "the read-only door is the same door");
      assert.throws(() => openDynamic(path, { legacy: "someone else" }), DynamicRetiredError, "a legacy open must name one of the readers the file lists");
      assert.equal(existsSync(path), false);
      const db = openDynamic(path, { legacy: "the git-road drain" });
      db.close();
      assert.equal(existsSync(path), true, "the git road's drain is let through, by name");
    });
    await withEnv({ WORLD_DYNAMIC_DB: path }, async () => {
      const db = openDynamic(path); db.close(); // off the flags, the store is what it was
    });
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); }
});

test("THE PANEL opens nothing on those flags and says the store is retired", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dyn-retired-panel-"));
  const path = join(dir, "dynamic.db");
  try {
    await withEnv({ WORLD_DYNAMIC_DB: path }, async () => { openDynamic(path).close(); });
    await withEnv({ ...PROD, WORLD_DYNAMIC_DB: path }, async () => {
      const h = dynamicHealth();
      assert.match(h.db.retired, /dynamic\.db is retired on this office's flags/);
      assert.equal(h.db.entities, undefined, "no count is read from a retired file");
    });
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); }
});

test("THE SAVE gets past the opener on those flags: it stops at the record, not at dynamic.db, and creates no file", () => {
  const dir = mkdtempSync(join(tmpdir(), "dyn-retired-save-"));
  const path = join(dir, "dynamic.db");
  try {
    const r = spawnSync(process.execPath, [join(ROOT, "tools", "crossing-save.mjs"), "--no-commit", "--state", join(dir, "STATE")], {
      cwd: ROOT, encoding: "utf8",
      env: { ...process.env, ...PROD, WORLD_DYNAMIC_DB: path, WORLD_CLONE: process.env.WORLD_CLONE ?? join(ROOT, "world-clone") },
    });
    const out = `${r.stdout}${r.stderr}`;
    assert.doesNotMatch(out, /dynamic\.db is retired|DynamicRetiredError/, `the save reached for the retired store: ${out.slice(0, 400)}`);
    assert.equal(existsSync(path), false, "and did not create it");
    assert.notEqual(r.status, 0, "with no reachable record it refuses — the point is WHERE");
    assert.match(out, /GATE REFUSED (world-store|register|world-clone|world-tools|holdings|emissions)/, out.slice(0, 400));
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); }
});

test("THE CENSUS: every src module that can open the store names why it cannot on those flags (presence, the hold door and the say door no longer open it on ANY flags)", () => {
  const files = readdirSync(join(ROOT, "src")).filter((f) => f.endsWith(".mjs"))
    .filter((f) => /openDynamic(ReadOnly)?\(/.test(readFileSync(join(ROOT, "src", f), "utf8").replace(/^\s*\/\/.*$/gm, "")))
    .sort();
  // Each entry is the reason the call is unreachable on the retired flags (or,
  // for the drain, why it is let through). A new caller reds this until it says.
  const WHY = {
    "dynamic-entities.mjs": "refreshEntities, which only the flag-off dynamic-rebuild tool calls; the crossing-save no longer does",
    "dynamic-store.mjs": "the opener itself, and the panel, which returns before opening when retired",
    "world-drain.mjs": "the git-road drain, the one named legacy reader",
    "world-journal.mjs": "draftsForKey, which no door calls (every door calls guardedDraftsForKey)",
  };
  assert.deepEqual(files, Object.keys(WHY).sort());
  assert.deepEqual(RETIRED_LEGACY_READERS, ["the git-road drain"]);
});
