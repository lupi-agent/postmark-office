// no-world-db.test.mjs — world.db's opener is gone, and stays gone (POS-270 lane
// W 3b, Keemin-ruled 2026-09-30).
//
// The office's world reads stand on the world graph snapshot (the store's, per
// settlement) or on their floors; nothing opens a world.db file any more. This
// is the grep that fails on one: every module the office, its children and its
// tools run is scanned, comments aside, for the names the file's opener went
// by, a path literal that ends in world.db, and the `worldDb` parameter that
// let a caller name a file.
//
// A COMMENT MAY SAY world.db (the history is worth keeping), and a message may
// say it is retired. CODE MAY NOT REACH FOR IT.

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { OFFICE_ROOT } from "./fixture-paths.mjs";

const ROOTS = ["src", "tools", join("world2", "tools")];
const FORBIDDEN = [
  [/\bWORLD_STORE_DB\b/, "the env key that pointed a reader at a file"],
  [/\bstoreDbPath\b/, "the path resolver every file reader shared"],
  [/\bloadWorldGraph\b/, "the file-to-graph loader"],
  [/\breadWorldDbTables\b/, "the file's one sqlite read"],
  [/\bDEFAULT_DB\b/, "the default world.db path"],
  [/\bopenWorldRead\b/, "the opener with a file floor"],
  [/\bworldDbPath\b/, "dynamic-entities' file path"],
  [/\bworldDb\b/, "a parameter that names a world.db file"],
  // a path's last segment: a quote or separator before it, a closing quote after
  // it that is not an apostrophe running on into a word ("world.db's" is prose)
  [/(^|[/\\"'`])world\.db["'`](?!\w)/, "a path literal ending in world.db"],
];

/** Code lines only: whole-line comments and block-comment bodies are history, not reach. */
function codeLines(text) {
  const out = [];
  let inBlock = false;
  text.split("\n").forEach((line, i) => {
    const t = line.trim();
    if (inBlock) { if (t.includes("*/")) inBlock = false; return; }
    if (t.startsWith("/*")) { if (!t.includes("*/")) inBlock = true; return; }
    if (t.startsWith("//") || t.startsWith("*")) return;
    out.push([i + 1, line.replace(/\s\/\/.*$/, "")]);
  });
  return out;
}

export function worldDbReach(root = OFFICE_ROOT) {
  const hits = [];
  for (const dir of ROOTS) {
    let files = [];
    try { files = readdirSync(join(root, dir)).filter((f) => f.endsWith(".mjs")); } catch { continue; }
    for (const f of files) {
      for (const [n, line] of codeLines(readFileSync(join(root, dir, f), "utf8")))
        for (const [re, what] of FORBIDDEN)
          if (re.test(line)) hits.push(`${dir}/${f}:${n} — ${what}: ${line.trim().slice(0, 140)}`);
    }
  }
  return hits;
}

test("NO WORLD.DB: nothing the office runs reaches for the file, by name, by path or by parameter", () => {
  const hits = worldDbReach();
  assert.deepEqual(hits, [], `world.db is retired, and these still reach for it:\n${hits.join("\n")}`);
});

test("the scan can fail: a line that reaches for the file is caught, a comment that remembers it is not", () => {
  const caught = codeLines([
    "// world.db was the old store; storeDbPath() resolved it",
    "const p = process.env.WORLD_STORE_DB ?? join(ROOT, \"world.db\");",
    " * readWorldDbTables(path) is gone",
  ].join("\n")).filter(([, l]) => FORBIDDEN.some(([re]) => re.test(l)));
  assert.equal(caught.length, 1, "exactly the code line is caught; the two comments are history");
  assert.equal(caught[0][0], 2);
});
