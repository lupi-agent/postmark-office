// guard-equality-import.test.mjs — importing the guard falsifier runs NOTHING
// (POS-142 S3, 2026-10-01).
//
// `falsifier-guard-equality.mjs` used to do its whole job at import: argv checks
// that exit, an env rewrite (WORLD2_PG_URL → the scratch), the office's imports
// and the run. Its G5 now runs read-only beside apex, standing and live through
// `falsifier-guard-g5.mjs`, which IMPORTS it, so an import that still rewrote the
// env would hand G5's pool the string "undefined" (measured: that is exactly
// what the first cut of this move did, and the runner died on ENOTFOUND base).
//
// So the import is held in a CHILD, with argv carrying no --world-repo and a
// reader URL in the env, and three things are asserted: it exits 0, prints
// nothing, and leaves every environment variable exactly as it found it. Then
// the entry is held too: run directly with no argv, it still stops on usage.
//
// Run: node --test test/guard-equality-import.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const TOOL = fileURLToPath(new URL("../world2/tools/falsifier-guard-equality.mjs", import.meta.url));

const PROBE = `
  const before = JSON.stringify(process.env);
  const m = await import(${JSON.stringify(pathToFileURL(TOOL).href)});
  const after = JSON.stringify(process.env);
  const changed = Object.keys({ ...JSON.parse(before), ...JSON.parse(after) })
    .filter((k) => JSON.parse(before)[k] !== JSON.parse(after)[k]);
  process.stdout.write(JSON.stringify({ changed, exports: Object.keys(m).sort() }));
`;

test("importing the guard falsifier exits nothing, prints nothing, and changes no environment variable", () => {
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", PROBE], {
    encoding: "utf8",
    env: { ...process.env, WORLD2_PG_URL: "postgres://snapshot_reader:pw@127.0.0.1:5432/world2_dev" },
  });
  assert.equal(r.status, 0, `the import exited ${r.status}: ${r.stderr.slice(0, 300)}`);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.changed, [], `the import rewrote ${out.changed.join(", ")}`);
  for (const name of ["loadOracles", "buildOracleAttachments", "g5Holdings", "g5Breaks"])
    assert.ok(out.exports.includes(name), `the guard exports ${name} for the G5-only entry`);
});

test("run DIRECTLY with no argv, it still stops on its usage line, exit 2: the entry is unchanged", () => {
  const r = spawnSync(process.execPath, [TOOL], { encoding: "utf8", env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: falsifier-guard-equality\.mjs --world-repo/);
});
