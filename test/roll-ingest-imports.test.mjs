// roll-ingest-imports.test.mjs — every path roll-ingest builds for import() resolves.
//
// THE INSTANCE (POS-242, the first rehearsal of train/2026-w40 on a copy of prod's
// store, 2026-09-26). 2c44ddd moved the town reader from `vendor/town.mjs` to
// `vendor/tools/lib/town.mjs`. `deriveRoll` built the OLD path with
// `join(OFFICE, "vendor", "town.mjs")` inside a dynamic `import()`, so no static
// import graph and no test saw it: the suite was green, and on a fresh w40 tree
// the clearing's first step (stamp-ingest -> deriveRoll) died with
// ERR_MODULE_NOT_FOUND. Prod ran only because the old file was still on the box's
// disk, and `release-train.yml` syncs `vendor/` with --delete, so the w40 deploy
// would have removed it and stopped every crossing after it.
//
// TWO FACES, because each can pass where the other cannot:
//   · READ: every `join(OFFICE, "…", …)` built inside an `import(` in the file
//     names a file that exists. This catches a path the call below never reaches.
//   · RUN: `deriveRoll` over an empty town gets PAST both imports and refuses with
//     its own words ("no WHITE_PAGES residents"), which is not ERR_MODULE_NOT_FOUND.
//     The imports run before the town is read, so reaching that sentence proves
//     they resolved.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveRoll } from "../world2/tools/roll-ingest.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = join(ROOT, "world2/tools/roll-ingest.mjs");

test("READ: every path roll-ingest builds for import() exists in this tree", () => {
  const src = readFileSync(FILE, "utf8");
  const built = [...src.matchAll(/import\(\s*pathToFileURL\(\s*join\(\s*OFFICE\s*,([^)]*)\)/g)]
    .map((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
  assert.ok(built.length >= 2, `expected roll-ingest's two built imports, found ${built.length} — the pattern this test reads has moved`);
  for (const parts of built) {
    const p = join(ROOT, ...parts);
    assert.ok(existsSync(p), `roll-ingest imports ${parts.join("/")}, which does not exist — a vendor move left this caller behind`);
  }
});

test("RUN: deriveRoll gets past its imports and refuses an empty town in its own words", async () => {
  const town = mkdtempSync(join(tmpdir(), "roll-ingest-imports-"));
  try {
    await assert.rejects(deriveRoll({ townRepo: town }), (err) => {
      assert.notEqual(err.code, "ERR_MODULE_NOT_FOUND", `an import did not resolve: ${err.message}`);
      assert.match(err.message, /no WHITE_PAGES residents/);
      return true;
    });
  } finally {
    rmSync(town, { recursive: true, force: true });
  }
});
