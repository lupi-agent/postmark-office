// households-read.test.mjs — GET /households answers the registry as the store holds it (POS-345).
//
// The town's tools and CI, the site's build and the PR witness (POS-348) read
// this instead of the printed tools/households.json / tools/github-ids.json.
// Its contract is in src/households-read.mjs's header; these hold it.
//
// THE FLIP: answer from the clone's printed files instead of the store and the
// REST test goes red, because the printout and the store disagree on purpose.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { fixtureDb } from "./fixture.mjs";
import { bootOnFreePort } from "./spawn-office.mjs";
import { indexStore, seedRegistry } from "./helpers/office-under-test.mjs";
import { rowsFromRegistry, registryFromRows, pinsFromRows } from "../src/registry-rows.mjs";
import { householdsRead, narrowTo, parseHandles, MAX_HANDLES } from "../src/households-read.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// THE STORE: two houses; kin has moved into ana's house.
const REGISTRY = { schema_version: 1, note: "printed from the store", households: {
  "ana-house": { name: "Ana's", human: "Ana", since: "2026-08-01", declared_by: "ana", accounts: [{ login: "ana-gh", id: 1 }, { login: "kin-gh", id: 2 }], residents: ["ana", "kin"] },
  "zed-house": { name: "Zed's", since: "2026-08-02", declared_by: "zed", accounts: [{ login: "zed-gh", id: 3 }], residents: ["zed"] },
} };
const PINS = { ana: { login: "ana-gh", id: 1, pinned: "2026-08-01" }, kin: { login: "kin-gh", id: 2, pinned: "2026-10-04" }, zed: { login: "zed-gh", id: 3 } };
const ROWS = rowsFromRegistry(REGISTRY, PINS);

test("the whole registry, in the two files' shapes, from the store", async () => {
  const { status, body } = await householdsRead({}, { rows: ROWS });
  assert.equal(status, 200);
  assert.equal(body.read, "households");
  assert.equal(body.from, "the registry store");
  assert.deepEqual(body.registry, registryFromRows(ROWS), "the object the drain renders tools/households.json from");
  assert.deepEqual(body.pins, pinsFromRows(ROWS), "the object the drain renders tools/github-ids.json from");
  assert.deepEqual(Object.keys(body.registry), ["schema_version", "note", "households"], "the file's own key order");
  assert.equal(body.handles, undefined);
});

test("?h= keeps only those handles' pins and the houses they stand in", async () => {
  const { status, body } = await householdsRead({ h: "kin,nobody" }, { rows: ROWS });
  assert.equal(status, 200);
  assert.deepEqual(body.handles, ["kin", "nobody"]);
  assert.deepEqual(Object.keys(body.registry.households), ["ana-house"], "kin stands in ana's house; nobody stands nowhere");
  assert.deepEqual(Object.keys(body.pins), ["kin"]);
  assert.equal(body.registry.schema_version, 1, "the registry's own keys always ride");
});

test("a malformed or oversized ?h= is a 422 that says how to ask", async () => {
  assert.equal((await householdsRead({ h: "" }, { rows: ROWS })).status, 422);
  assert.equal((await householdsRead({ h: "a b" }, { rows: ROWS })).status, 422);
  const many = Array.from({ length: MAX_HANDLES + 1 }, (_, i) => `h${i}`).join(",");
  assert.match((await householdsRead({ h: many }, { rows: ROWS })).body.hint, /at most 50/);
  assert.deepEqual(parseHandles("a,a, b"), { handles: ["a", "b"] });
  assert.deepEqual(narrowTo(REGISTRY, PINS, ["zed"]).pins, { zed: PINS.zed });
});

test("a store the office cannot read is a 503, never the printout", async () => {
  const { status, body } = await householdsRead({}, { rows: null });
  assert.equal(status, 503);
  assert.match(body.hint, /not the record/);
});

// ── over REST, public, on a real store ──────────────────────────────────────

let ix, child, base, tmp;
before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "pos345-door-"));
  const dbPath = join(tmp, "fixture.db");
  fixtureDb(dbPath).close();
  // The clone's PRINTOUT disagrees with the store: kin alone in a house of their own.
  const clone = join(tmp, "town-clone");
  mkdirSync(join(clone, "tools"), { recursive: true });
  mkdirSync(join(clone, "WHITE_PAGES"), { recursive: true });
  writeFileSync(join(clone, "tools", "households.json"), JSON.stringify({ schema_version: 1, households: {
    "kin-alone": { accounts: [{ login: "kin-gh", id: 2 }], residents: ["kin"] } } }));
  writeFileSync(join(clone, "tools", "github-ids.json"), JSON.stringify({ kin: { login: "kin-gh", id: 2 } }));
  ix = await indexStore(dbPath);
  await seedRegistry(ix.store, REGISTRY, PINS);
  ({ child, port: base } = await bootOnFreePort((port) => spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", String(port),
    "--db", dbPath, "--oauth-db", join(tmp, "oauth.db")], {
    env: { ...process.env, WORLD2_PG: ix.env.WORLD2_PG, WORLD2_PG_URL: ix.env.WORLD2_PG_URL, TOWN_CLONE: clone, TOWN_PUSH: "", OFFICE_READ_WORKERS: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  })));
  base = `http://127.0.0.1:${base}`;
});
after(async () => {
  if (child && child.exitCode === null) { const gone = new Promise((ok) => child.on("exit", ok)); child.kill(); await gone; }
  await ix?.stop();
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("GET /households needs no key, and answers the store's houses, not the clone's printout", async () => {
  const r = await fetch(`${base}/households?h=kin`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.deepEqual(Object.keys(body.registry.households), ["ana-house"], "the store's house for kin, not the printout's kin-alone");
  assert.deepEqual(body.registry.households["ana-house"].residents, ["ana", "kin"]);
  const all = await (await fetch(`${base}/households`)).json();
  assert.deepEqual(Object.keys(all.registry.households), ["ana-house", "zed-house"]);
  assert.deepEqual(Object.keys(all.pins).sort(), ["ana", "kin", "zed"]);
});
