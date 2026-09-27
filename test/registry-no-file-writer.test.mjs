// registry-no-file-writer.test.mjs — ONE WRITER FOR THE TOWN'S TWO REGISTERS (POS-158).
//
// THE LAW. `tools/households.json` and `tools/github-ids.json` are a RENDERING
// of the store (019_households.sql, POS-187). Exactly one module may produce
// their bytes, and exactly one may write them to a clone. Everything else reads
// the record.
//
// WHY THIS IS A TEST AND NOT A CONVENTION. The registry had FOUR office writers
// when this lane opened — `src/declare.mjs` (the declaration's file set),
// `src/residency.mjs` (the join PR's diff, twice: the registry and the pin),
// `src/town-drain.mjs` (the crossing) — and each was correct on its own. Put a
// drain beside them and they stop being redundant and start being a race: the
// drain renders the WHOLE registry from the table, so a second writer's row
// either vanishes at the next crossing or trips the drain's shrink guard and
// stops it. `src/registry-rows.mjs`'s header had already recorded the shape of
// the damage — two spellings of `serializePins`, one sorted and one not, "a
// declaration landing through declare.mjs's unsorted writer would append its
// new handle at the END of the file and `--check` would red on the next
// crossing". That divergence was named and left; this test is what ends it.
//
// A convention cannot hold this. The next person to add a door will reach for
// `serializeRegistry` because it is exported and it is exactly what they want,
// and nothing will tell them no. This does.
//
// ── THE SHAPE, AND WHY IT IS THE SERIALIZERS AND NOT THE PATHS ──────────────
//
// An earlier pass of this test grepped for the two PATH constants next to a
// write verb. It found ZERO matches — including in the drain, which spells its
// write across two lines — so it would have passed with every writer restored.
// A probe that cannot fail is not a probe (HQ: "verification probes must be
// able to fail"), so the target moved to the thing that is actually load
// bearing: THE BYTES. Both files are produced by `serializeRegistry` and
// `serializePins`, and a module that does not call either cannot write them,
// whatever it does with a path.
//
// `tools/pos158-restore-a-file-writer.sh` is the flip: it restores one real
// writer to `src/declare.mjs` and this file must red. It asserts its own match
// count and exits 1 on zero, so a flip that patched nothing cannot run green.

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every `.mjs` the office ships, as { file, lines }. */
/**
 * Every `.mjs` the office ships, as { file, lines } — RECURSIVELY (review 6/6).
 *
 * The first pass read `src/` and `tools/` one level deep, which is where every
 * writer happened to live on the day it was written. A guard whose reach stops
 * at the top of a directory is a guard somebody walks under by making a
 * subdirectory, and `world2/tools/` is already one level further down than that
 * scan could see.
 */
function sources(dirs = ["src", "tools", "world2/tools", "deploy"]) {
  const out = [];
  const walk = (rel) => {
    let entries;
    try { entries = readdirSync(join(ROOT, rel), { withFileTypes: true }); }
    catch { return; }                       // a directory this checkout does not have
    for (const e of entries) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const child = `${rel}/${e.name}`;
      if (e.isDirectory()) { walk(child); continue; }
      if (!e.name.endsWith(".mjs")) continue;
      out.push({ file: child, lines: readFileSync(join(ROOT, child), "utf8").split(/\r?\n/) });
    }
  };
  for (const d of dirs) walk(d);
  return out;
}

test("the scan REACHES a nested file — a guard that stops at the top level guards nothing", () => {
  // The probe on the probe. `src/` has no subdirectories today, so a
  // non-recursive scan and a recursive one return the same set and the change
  // would be untestable by its result. `world2/tools/` is a real directory one
  // level deeper than the first pass could see, and finding a file there is
  // what says the walk descends.
  const files = sources().map((s) => s.file);
  assert.ok(files.some((f) => f.startsWith("world2/tools/")),
    "the scan must reach world2/tools/, which the first pass could not see");
  assert.ok(files.length > 40, `only ${files.length} files scanned — the walk is not walking`);
});

// Comment lines are excluded, and deliberately: this file's own prose names
// every retired writer, and so do the headers of the five modules that used to
// be one. A test that counted the word would be counting its own explanation.
const isCode = (l) => {
  const t = l.trim();
  return t.length > 0 && !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
};

const hits = (re) => {
  const found = [];
  for (const { file, lines } of sources())
    lines.forEach((l, i) => { if (isCode(l) && re.test(l)) found.push({ file, line: i + 1, text: l.trim() }); });
  return found;
};

// THE ONE PLACE THE BYTES ARE MADE. `src/residency.mjs` DEFINES the two
// serializers — it is the town pen's own writer and that is where it belongs —
// and `src/registry-rows.mjs` is the only module that CALLS them, inside
// `renderRegistry`, which `tools/registry-drain.mjs` is the only caller of.
const BYTES_MAY_BE_MADE_IN = new Set(["src/registry-rows.mjs"]);

test("the two registers' BYTES are produced in exactly one module", () => {
  const calls = hits(/\bserialize(Registry|Pins)\s*\(/);
  assert.ok(calls.length > 0, "the probe must find the real renderer, or it is asserting nothing");
  const strays = calls.filter((h) => !BYTES_MAY_BE_MADE_IN.has(h.file));
  assert.deepEqual(strays, [],
    `these call the town registry's serializers outside ${[...BYTES_MAY_BE_MADE_IN].join(", ")} — `
    + "the registry is store-of-record and a second writer either loses its row at the next drain "
    + "or stops the drain with the shrink guard:\n"
    + strays.map((h) => `  ${h.file}:${h.line}  ${h.text}`).join("\n"));
  assert.deepEqual([...new Set(calls.map((h) => h.file))], ["src/registry-rows.mjs"]);
  assert.equal(calls.length, 2, "renderRegistry makes both files and nothing else makes either");
});

test("no module but the drain pairs a register PATH with content to write", () => {
  // The second half of the law, and it catches the shapes the serializer probe
  // would miss: a caller that hands somebody else's bytes to a register path —
  // `{ path: REGISTRY_PATH, content: … }` (declare.mjs's retired file set),
  // `put(REGISTRY_PATH, …)` (town-drain.mjs's retired crossing write),
  // `files.push({ path: PINS_PATH, … })` (residency.mjs's retired PR diff).
  //
  // A FIRST ATTEMPT AT THIS PROBE MATCHED THE WRONG THING and is worth keeping
  // in the record: it looked for `writeFileSync(abs, content)`, which is the
  // drain's own spelling — and also `town-drain.mjs`'s `put()`, which writes
  // WHITE_PAGES cards and has nothing to do with the registry. A check must
  // read the behaviour it names, so it names the PATH now, not the verb.
  const paired = hits(/\b(REGISTRY_PATH|PINS_PATH)\b/)
    .filter((h) => /\b(content|put|push|writeFileSync)\b/.test(h.text));
  assert.ok(paired.length > 0, "the probe must find the drain's own writer, or it is asserting nothing");
  const strays = paired.filter((h) => h.file !== "tools/registry-drain.mjs");
  assert.deepEqual(strays, [],
    "these hand bytes to a register path outside the drain:\n"
    + strays.map((h) => `  ${h.file}:${h.line}  ${h.text}`).join("\n"));
});

test("no module but the pen's own declares the two paths", () => {
  // Two modules spelling one path string is how they drift. `src/declare.mjs`
  // re-exports them rather than restating them, which this allows and a second
  // `const PINS_PATH = "tools/github-ids.json"` would not.
  const decls = hits(/=\s*"tools\/(households|github-ids)\.json"/);
  assert.deepEqual([...new Set(decls.map((h) => h.file))], ["src/residency.mjs"]);
  assert.equal(decls.length, 2);
});

test("the five write-path readers have left the file", () => {
  // POS-187's (a) list, by name. Each used to parse one or both registers off a
  // clone or through the pen; each now reads the record. The probe is that none
  // of them names a register path beside a read verb any more.
  const FIVE = [
    "src/residency.mjs", "src/declare.mjs", "src/declare-exec.mjs",
    "src/town-drain.mjs", "tools/settle-anchored-berths.mjs",
  ];
  const reads = hits(/(readJson|readJsonFrom|readTownJson|parseFile|readFileSync)\s*\([^)]*\b(REGISTRY_PATH|PINS_PATH)\b/);
  const strays = reads.filter((h) => FIVE.includes(h.file));
  assert.deepEqual(strays, [],
    "these still read a register off a file rather than off the record:\n"
    + strays.map((h) => `  ${h.file}:${h.line}  ${h.text}`).join("\n"));
});

test("every one of the five imports the record's readers, so the move is real and not a deletion", async () => {
  // A reader that simply STOPPED reading would pass every probe above while
  // answering from nothing. Each of the five must now reach the store — four
  // directly, and `declare-exec.mjs` through `declare.mjs`'s `readRegisters`,
  // which is the shared one both halves of that door use.
  const expect = {
    "src/residency.mjs": /from "\.\/registry-store\.mjs"/,
    "src/declare.mjs": /from "\.\/registry-store\.mjs"/,
    "src/declare-exec.mjs": /readRegisters/,
    "src/town-drain.mjs": /from "\.\/registry-store\.mjs"/,
    "tools/settle-anchored-berths.mjs": /from "\.\.\/src\/registry-store\.mjs"/,
  };
  for (const [file, re] of Object.entries(expect)) {
    const src = readFileSync(join(ROOT, file), "utf8");
    assert.match(src, re, `${file} must read the record`);
  }
});
