// registry-file.mjs — write the store's household registry to a file, for the town's tools (POS-345 b).
//
//   node deploy/registry-file.mjs <path>
//
// The town's readers (stamp-verify, household-keys, settle, the welcome verbs,
// the Registrar's WINDOW build) take `--registry <file|url>` and read the store's
// registry from it rather than the printed tools/households.json and
// tools/github-ids.json. When the OFFICE runs one of them, this writes the file
// from the store (`loadRegistryRows`) in the same document the office's public
// GET /households answers: `{ read, registry, pins, from }`.
//
// Exit 0 when written; 2 when the store could not be read, and then NOTHING is
// written — a tool handed the missing path refuses by name, never reads the
// printout in its place.

import { writeFileSync, realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { householdsRead } from "../src/households-read.mjs";

export async function writeRegistryFile(path, { rows = undefined } = {}) {
  const { status, body } = await householdsRead({}, { rows });
  if (status !== 200) return { written: false, why: body?.hint ?? `the registry read answered ${status}` };
  writeFileSync(path, JSON.stringify(body));
  return { written: true, households: Object.keys(body.registry.households ?? {}).length, pins: Object.keys(body.pins ?? {}).length };
}

async function main(argv = process.argv.slice(2)) {
  const path = argv[0];
  if (!path) { console.error("usage: registry-file.mjs <path>"); return 2; }
  const r = await writeRegistryFile(path);
  if (!r.written) { console.error(`registry-file: nothing written — ${r.why}`); return 2; }
  console.error(`registry-file: ${r.households} households, ${r.pins} pins from the store → ${path}`);
  return 0;
}

const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) process.exit(await main());
