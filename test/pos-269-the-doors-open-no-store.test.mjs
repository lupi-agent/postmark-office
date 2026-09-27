// pos-269-the-doors-open-no-store.test.mjs — the say, walk, crossing, ride,
// stance and mark doors write to the record and open no sqlite store to do it.
//
// POS-269. Each of these doors used to open `dynamic.db` in WRITE mode and hand
// the handle to a pen that has not touched it since G1 (POS-156). The open was
// not free: a WAL pragma, the whole DDL and a lock, on every act, ahead of the
// pen. On the say it sat outside the pen's own refusal, so a locked store threw
// a 500 at a resident whose words the record would have taken.
//
// WHAT IS ASSERTED:
//
//   the say takes no store      behavioural: `penVoiceAct` with the store's path
//                               pointed at a file that does not exist. The say
//                               lands, the pen is handed no handle, and the file
//                               is still not there afterwards.
//   the refusal is unchanged    an unreachable record is still the ruled bounce.
//   the source opens nothing    a pin on the five files, because the behavioural
//                               test reaches one door and an open could come
//                               back in any of the other five.
//
//   node --test test/pos-269-the-doors-open-no-store.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "pos269-"));
const NOWHERE = join(tmp, "dynamic.db");
const was = process.env.WORLD_DYNAMIC_DB;
process.env.WORLD_DYNAMIC_DB = NOWHERE;
process.env.WORLD_CLONE ??= HERE;
after(() => {
  if (was === undefined) delete process.env.WORLD_DYNAMIC_DB; else process.env.WORLD_DYNAMIC_DB = was;
  try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ }
});

const { penVoiceAct } = await import("../src/world.mjs");

const voice = { handle: "wright", text: "evening", x: 10, y: 20, at: Date.parse("2026-09-27T01:00:00Z"), place: "the snug" };
const stamp = async () => ({ at: { anchor: "the-town/the-snug", dx: 0, dy: 0 }, witnesses: { source: "presence", list: [] } });

test("THE SAY TAKES NO STORE — the pen is handed no handle and dynamic.db is never created", async () => {
  const handed = [];
  const out = await penVoiceAct(voice, null, {
    witnessStampAt: stamp,
    currentCrossing: () => 200,
    appendActFlipped: async (db, entry) => { handed.push(db); return { seq: null, actId: 4242, record: "acts", ...entry }; },
  });
  assert.deepEqual(out, { ok: true, seq: null, actId: 4242 });
  assert.deepEqual(handed, [null], "the pen was handed a store handle");
  assert.equal(existsSync(NOWHERE), false, "a say created dynamic.db");
});

test("THE REFUSAL IS UNCHANGED — an unreachable record is the ruled bounce, and still no store", async () => {
  const err = Object.assign(new Error("the office's record cannot be reached — nothing was written, and nothing was lost."), { name: "PenUnreachableError" });
  const out = await penVoiceAct(voice, null, {
    witnessStampAt: stamp,
    currentCrossing: () => 200,
    appendActFlipped: async () => { throw err; },
  });
  assert.equal(out.error, "bounce");
  assert.equal(out.defect, err.message);
  assert.equal(existsSync(NOWHERE), false);
});

test("THE SOURCE OPENS NOTHING — no dynamic.db open in the six doors' files but the arena's wheel", () => {
  const opens = (file) => readFileSync(join(HERE, "..", "src", file), "utf8")
    .split("\n").filter((l) => /\bopenDynamic\(/.test(l) && !/^\s*(\/\/|\*)/.test(l));
  for (const file of ["world.mjs", "walk-exec.mjs", "crossing-exec.mjs", "world-stance.mjs"])
    assert.deepEqual(opens(file), [], `${file} opens the dynamic store again`);
  // The one left in the apex is the arena's enter/leave wheel (P-143), which
  // reads and writes the arena journal by ruling.
  const apex = opens("world-apex.mjs");
  assert.equal(apex.length, 1, `world-apex.mjs opens the store ${apex.length} times, expected only the arena wheel's`);
  assert.match(apex[0], /dyn = openDynamic\(\);/);
});
