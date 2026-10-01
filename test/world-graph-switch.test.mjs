// world-graph-switch.test.mjs — the office refuses to boot with no world graph
// source (POS-270 lane W 3b, Keemin-ruled 2026-09-30).
//
// world.db is retired, so an office not pointed at the world 2.0 store would
// boot with NO world and answer every world read from its floor: disclosed,
// and wrong in the same quiet way for the whole office. It refuses instead
// (EX_CONFIG, 78, as the key store's refusal does), unless an operator says
// plainly that this office serves no world graph (WORLD_GRAPH_NONE=1), or a
// test hands it rows (WORLD_GRAPH_ROWS, under node --test). Driven, not read.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { OFFICE_ROOT as ROOT } from "./fixture-paths.mjs";
import { fixtureDb } from "./fixture.mjs";

const tmp = mkdtempSync(join(tmpdir(), "world-graph-switch-"));
after(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }));
const dbPath = join(tmp, "fixture.db");
fixtureDb(dbPath).close();

/** Boot an office on `env`; resolve how it ended: exited (code, stderr) or listened (then stopped). */
function boot(env, label) {
  return new Promise((ok) => {
    const p = spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", "0", "--db", dbPath,
      "--oauth-db", join(tmp, `oauth-${label}.db`), "--roles-db", join(tmp, `roles-${label}.db`)], {
      env: { ...process.env, WORLD2_PG: "", WORLD2_PG_URL: "", WORLD_GRAPH_NONE: "", WORLD_GRAPH_ROWS: "", WORLD_GRAPH_PG_URL: "",
        OFFICE_KEYS: "switchkey=keemin:wright", TOWN_CLONE: join(tmp, "no-clone"), WORLD_CLONE: join(tmp, "no-world-clone"),
        VOICES_LOG: join(tmp, `voices-${label}.jsonl`), TOWN_PUSH: "", OFFICE_READ_WORKERS: "0", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "", err = "", listened = false;
    const t = setTimeout(() => { p.kill(); ok({ timedOut: true, out, err }); }, 20_000);
    p.stdout.on("data", (d) => {
      out += String(d);
      if (!listened && /listening on :\d+/.test(out)) { listened = true; clearTimeout(t); p.kill(); }
    });
    p.stderr.on("data", (d) => { err += String(d); });
    p.on("exit", (code) => { clearTimeout(t); ok(listened ? { listened: true, out, err } : { code, out, err }); });
  });
}

test("NO SOURCE, NO BOOT: an office with no store, no override and no rows refuses with EX_CONFIG and says why", async () => {
  const r = await boot({}, "none");
  assert.notEqual(r.listened, true, "the office booted with no world graph source — it would serve every world read from its floor");
  assert.equal(r.timedOut, undefined, "a hang is not a refusal");
  assert.equal(r.code, 78);
  assert.match(r.err, /the world graph has no source/);
  assert.match(r.err, /WORLD_GRAPH_NONE=1/, "the refusal names the operator's way out");
});

test("WORLD_GRAPH_NONE=1 boots an office that serves no world graph, and it says so", async () => {
  const r = await boot({ WORLD_GRAPH_NONE: "1" }, "override");
  assert.equal(r.listened, true, `the override did not boot: exit ${r.code}\n${r.err.slice(-400)}`);
});

test("a test's rows are a source: WORLD_GRAPH_ROWS under node --test boots", async () => {
  const rows = join(tmp, "rows.json");
  writeFileSync(rows, JSON.stringify({ meta: [{ key: "hydration_status", value: "OK" }], nodes: [], edges: [], events: [], geometryVersions: [], lintFindings: [] }));
  const r = await boot({ WORLD_GRAPH_ROWS: rows }, "rows");
  assert.equal(r.listened, true, `an office on a test's rows did not boot: exit ${r.code}\n${r.err.slice(-400)}`);
});
