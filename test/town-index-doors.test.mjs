// town-index-doors.test.mjs — the switch, at the doors (POS-268).
//
//   EMBEDDED_PG_DIR=<dir with embedded-postgres> node --test test/town-index-doors.test.mjs
//
// Three offices over ONE office.db (the fixture's): one with the switch off,
// one with TOWN_INDEX_READS=store over a real Postgres seeded from that same
// office.db, and one switched to a store that is not there. The moved doors
// must answer the switched office byte for byte as they answer the unswitched
// one, say which index they read (x-postmark-town-index-as-of), and, when the
// store cannot be read, refuse with a 503 rather than fall back to office.db.
// The MCP twins go through callTool, the one dispatch every MCP door shares.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { fixtureDb } from "./fixture.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { copyIndexToStore } from "./helpers/index-to-store.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(join(tmpdir(), "town-index-doors-"));
const dbPath = join(tmp, "office.db");
let store = null, skip = false;
const offices = {};

function office(name, env) {
  const child = spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", "0", "--db", dbPath,
    "--oauth-db", join(tmp, `${name}-oauth.db`), "--roles-db", join(tmp, `${name}-roles.db`)], {
    env: { ...process.env, TOWN_CLONE: join(tmp, "no-clone-here"), WORLD_CLONE: join(tmp, "no-world-clone"),
      VOICES_LOG: join(tmp, `${name}-voices.jsonl`), TOWN_PUSH: "", WORLD_STORE_DB: join(tmp, "no-world.db"),
      OFFICE_READ_WORKERS: "0", TOWN_INDEX_READS: undefined, WORLD2_PG: undefined, WORLD2_PG_URL: undefined, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error(`${name}: the office never listened`)), 20_000);
    child.stdout.on("data", (d) => {
      const m = /listening on :(\d+)/.exec(String(d));
      if (m) { clearTimeout(t); offices[name] = { child, base: `http://127.0.0.1:${m[1]}` }; ok(); }
    });
    child.on("exit", (c) => no(new Error(`${name}: the office exited early (${c})`)));
  });
}

before(async () => {
  store = await startStore();
  if (store.skip) { skip = store.skip; return; }
  const db = fixtureDb(dbPath);
  const w = await store.connect("law_ingester");
  await copyIndexToStore(w, db);
  await w.end();
  db.close();
  await office("plain", {});
  await office("switched", { TOWN_INDEX_READS: "store", WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api") });
  await office("cut-off", { TOWN_INDEX_READS: "store", WORLD2_PG: "1", WORLD2_PG_URL: "postgres://office_api:x@127.0.0.1:9/none" });
});

after(async () => {
  for (const { child } of Object.values(offices)) {
    if (child.exitCode === null) { const gone = new Promise((ok) => child.on("exit", ok)); child.kill(); await gone; }
  }
  if (store?.stop) await store.stop();
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const DOORS = ["/repo/log", "/repo/log?limit=1", "/repo/log?path=WHITE_PAGES/", "/repo/log?author=keemin", "/repo/log?since=2026-07-05&until=2026-07-12",
  "/regions", "/regions?limit=1&offset=0", "/regions/the-terrace", "/regions/nowhere",
  "/bulletin", "/bulletin/settling-in", "/bulletin/nope"];

test("every moved door answers the switched office exactly as the unswitched one, and names the store's as-of", async (t) => {
  if (skip) return t.skip(skip);
  for (const door of DOORS) {
    const a = await fetch(offices.plain.base + door);
    const b = await fetch(offices.switched.base + door);
    assert.equal(b.status, a.status, `${door}: status`);
    assert.equal(await b.text(), await a.text(), `${door}: body, byte for byte`);
    assert.equal(a.headers.get("x-postmark-town-index-as-of"), null, `${door}: the unswitched office reads no store and says none`);
    if (a.status === 200) assert.equal(b.headers.get("x-postmark-town-index-as-of"), "fixturesha000000000000000000000000000000", `${door}: names the index it read`);
  }
});

test("a switched door whose store cannot be read refuses with a 503, and never answers from office.db", async (t) => {
  if (skip) return t.skip(skip);
  for (const door of ["/repo/log", "/regions", "/regions/the-terrace", "/bulletin", "/bulletin/settling-in"]) {
    const r = await fetch(offices["cut-off"].base + door);
    assert.equal(r.status, 503, door);
    const body = await r.json();
    assert.match(body.defect, /town index \(the store\) cannot be reached/, door);
  }
  // an unmoved door on the same office still answers from office.db
  assert.equal((await fetch(offices["cut-off"].base + "/stamps")).status, 200);
});

test("the MCP twins (list_commits, list_regions, read_bulletin) answer through the store when switched", async (t) => {
  if (skip) return t.skip(skip);
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const { callTool } = await import("../src/mcp.mjs");
  const keep = { TOWN_INDEX_READS: process.env.TOWN_INDEX_READS, WORLD2_PG: process.env.WORLD2_PG, WORLD2_PG_URL: process.env.WORLD2_PG_URL };
  try {
    const asks = [["list_commits", {}], ["list_commits", { path: "WHITE_PAGES/", limit: 1 }], ["list_regions", {}],
      ["read_bulletin", {}], ["read_bulletin", { limit: 1 }], ["read_bulletin", { slug: "settling-in" }], ["read_bulletin", { slug: "nope" }]];
    const plain = [];
    for (const [tool, args] of asks) plain.push(JSON.stringify(await callTool(tool, args, { db })));
    Object.assign(process.env, { TOWN_INDEX_READS: "store", WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api") });
    for (const [i, [tool, args]] of asks.entries())
      assert.equal(JSON.stringify(await callTool(tool, args, { db })), plain[i], `${tool} ${JSON.stringify(args)}`);
  } finally {
    for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    db.close();
  }
});
