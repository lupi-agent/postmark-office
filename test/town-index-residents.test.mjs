// town-index-residents.test.mjs — group 3 of POS-268: the residents, the town
// card and the doorstep answer from the store exactly as from office.db.
//
//   EMBEDDED_PG_DIR=<dir with embedded-postgres> node --test test/town-index-residents.test.mjs
//
// test/fixture.mjs's town plus what the ports had to get right: a handle the
// door could never admit (`_archived`, on the roll's table and never on the
// roll), an office resident, a resident whose handle sorts differently bytewise
// than in an English collation, a window state, and a PSA posting with one
// entry inside the week and one outside it. The store is seeded from the same
// office.db. Every reader is compared as the bytes a door sends; then the doors
// over two offices (switch off and on) and one whose store is gone, the MCP
// cases, and household { read: address | window | home | doorstep }.

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
import * as office from "../src/queries.mjs";
import * as store from "../src/town-index-store.mjs";
import { residentSegments } from "../src/house-bundle.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(join(tmpdir(), "town-index-residents-"));
const dbPath = join(tmp, "office.db");
const NOW = Date.parse("2026-07-14T12:00:00Z");
let s = null, skip = false, api, db, meta;
const offices = {};

before(async () => {
  s = await startStore();
  if (s.skip) { skip = s.skip; return; }
  db = fixtureDb(dbPath);
  const R = db.prepare("INSERT INTO residents VALUES (?, ?)");
  R.run("_archived", JSON.stringify({ handle: "_archived", address: { data: { joined: "2026-07-13" } } }));
  R.run("Zed", JSON.stringify({ handle: "Zed", display: "Zed of the Lamplight", last_active: "2026-07-13T10:00:00.000Z",
    address: { data: { joined: "2026-07-13", github: "zed-gh" }, body: "# Zed" }, window_state: { lit: true, note: "back soon" } }));
  R.run("illuminator", JSON.stringify({ handle: "illuminator", address: { data: { joined: "2026-07-02", office: "true" }, body: "# The Illuminator" } }));
  db.prepare("INSERT INTO bulletin VALUES (?, ?)").run(office.PSA_SLUG, JSON.stringify({ slug: office.PSA_SLUG, data: { title: "PSAs" },
    body: "# Public service announcements\n\n## 2026-07-12 · The quay reopens\n\nThe steps are dry.\n\n## 2026-06-01 · Old news\n\nLong ago." }));
  meta = Object.fromEntries(db.prepare("SELECT key, value FROM meta").all().map((r) => [r.key, r.value]));
  const w = await s.connect("law_ingester");
  await copyIndexToStore(w, db);
  await w.end();
  api = await s.connect("office_api");

  // "plain" reaches the same store for everything else (the marks garnish reads
  // the docket there), so the ONE difference between the two offices is the switch.
  for (const [name, env] of [["plain", { WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") }], ["switched", { TOWN_INDEX_READS: "store", WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") }],
    ["cut-off", { TOWN_INDEX_READS: "store", WORLD2_PG: "1", WORLD2_PG_URL: "postgres://office_api:x@127.0.0.1:9/none" }]]) {
    const child = spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", "0", "--db", dbPath,
      "--oauth-db", join(tmp, `${name}-oauth.db`), "--roles-db", join(tmp, `${name}-roles.db`)], {
      env: { ...process.env, TOWN_CLONE: join(tmp, "no-clone-here"), WORLD_CLONE: join(tmp, "no-world-clone"), VOICES_LOG: join(tmp, `${name}-voices.jsonl`),
        TOWN_PUSH: "", WORLD_STORE_DB: join(tmp, "no-world.db"), OFFICE_READ_WORKERS: "0",
        TOWN_INDEX_READS: undefined, WORLD2_PG: undefined, WORLD2_PG_URL: undefined, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise((ok, no) => {
      const t = setTimeout(() => no(new Error(`${name}: the office never listened`)), 20_000);
      child.stdout.on("data", (d) => { const m = /listening on :(\d+)/.exec(String(d)); if (m) { clearTimeout(t); offices[name] = { child, base: `http://127.0.0.1:${m[1]}` }; ok(); } });
      child.on("exit", (c) => no(new Error(`${name}: the office exited early (${c})`)));
    });
  }
});

after(async () => {
  for (const { child } of Object.values(offices)) if (child.exitCode === null) { const gone = new Promise((ok) => child.on("exit", ok)); child.kill(); await gone; }
  if (api) await api.end().catch(() => {});
  if (s?.stop) await s.stop();
  db?.close();
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

// the bytes a door sends; a live clock (the next boat, today's minute) is not the index's to agree on
const bytes = (o) => JSON.stringify(o, (k, v) => (k === "next_crossing" || k === "today" ? undefined : v));
// on a difference, the first path that differs, so a red says where rather than printing two whole doorsteps
const firstDiff = (x, y, p = "$") => {
  if (JSON.stringify(x) === JSON.stringify(y)) return null;
  if (!x || !y || typeof x !== "object" || typeof y !== "object") return `${p}: store ${JSON.stringify(x)?.slice(0, 160)} · office ${JSON.stringify(y)?.slice(0, 160)}`;
  const kx = Object.keys(x), ky = Object.keys(y);
  if (kx.join() !== ky.join()) return `${p}: keys store [${kx}] · office [${ky}]`;
  for (const k of kx) { const d = firstDiff(x[k], y[k], `${p}.${k}`); if (d) return d; }
  return null;
};
const same = async (label, oldAnswer, newAnswer) => {
  const [o, n] = [await oldAnswer, await newAnswer];
  if (bytes(n) !== bytes(o)) assert.fail(`${label}: ${firstDiff(JSON.parse(bytes(n) ?? "null"), JSON.parse(bytes(o) ?? "null"))}`);
};

test("the roll, the roster and the town card answer as office.db does", async (t) => {
  if (skip) return t.skip(skip);
  store.__resetRosterForTest();
  await same("residentList", office.residentList(db), store.residentList(api));
  for (const o of [{}, { limit: 2 }, { limit: 2, offset: 2 }, { since: "2026-07-01" }, { office: true }, { office: false, limit: 1 }, { limit: "x", offset: -1 }])
    await same(`residentPage ${JSON.stringify(o)}`, office.residentPage(db, o), store.residentPage(api, o));
  await same("townSummary", office.townSummary(db, meta), store.townSummary(api));
  await same("officeHandles", office.officeHandles(db), store.officeHandles(api));
});

test("resident, windowRead and psaFold answer as office.db does", async (t) => {
  if (skip) return t.skip(skip);
  for (const h of ["wright", "limen", "Zed", "postmaster", "nobody", "_archived"]) {
    await same(`resident ${h}`, office.resident(db, h, {}), store.resident(api, h, {}));
    await same(`windowRead ${h}`, office.windowRead(db, h, {}), store.windowRead(api, h, {}));
  }
  for (const now of [NOW, Date.parse("2026-08-30T00:00:00Z")]) await same(`psaFold at ${now}`, office.psaFold(db, { now }), store.psaFold(api, { now }));
});

test("the doorstep and a resident's house segments answer as office.db does", async (t) => {
  if (skip) return t.skip(skip);
  for (const h of ["wright", "limen", "Zed", "nobody"])
    for (const o of [{}, { slim: true }, { conversationsOffset: 1 }])
      await same(`doorstep ${h} ${JSON.stringify(o)}`, office.doorstep(db, h, meta.as_of, { nowMs: NOW, fresh: {}, ...o }), store.doorstep(api, h, "ignored", { nowMs: NOW, fresh: {}, ...o }));
  for (const h of ["wright", "Zed"]) await same(`residentSegments ${h}`, residentSegments(db, h, {}), store.residentSegments(api, h, {}));
});

test("the store's roll, held for the sync readers, is the roll", async (t) => {
  if (skip) return t.skip(skip);
  const keep = { WORLD2_PG: process.env.WORLD2_PG, WORLD2_PG_URL: process.env.WORLD2_PG_URL };
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: s.url("office_api"), max: 2 });
  const pen = await import("../src/world2-pen.mjs");
  try {
    Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") });
    pen.__setPoolForTest(pool);
    assert.deepEqual(await store.refreshStoreRoll(), office.residentList(db).map((r) => r.handle));
    assert.deepEqual(store.storeRollHandles(), office.residentList(db).map((r) => r.handle), "held until the next refresh");
  } finally {
    pen.__setPoolForTest(null); await pool.end();
    for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

const DOORS = ["/residents", "/residents?office=true", "/residents?limit=1&offset=1", "/residents/wright", "/residents/Zed", "/residents/nobody", "/town", "/doorstep/wright", "/doorstep/nobody"];

test("every moved REST door answers the switched office exactly as the unswitched one", async (t) => {
  if (skip) return t.skip(skip);
  for (const door of DOORS) {
    const a = await fetch(offices.plain.base + door), b = await fetch(offices.switched.base + door);
    assert.equal(b.status, a.status, `${door}: status`);
    const [ta, tb] = [await a.text(), await b.text()];
    const norm = (x) => { try { return bytes(JSON.parse(x)); } catch { return x; } };
    if (norm(tb) !== norm(ta)) { let d; try { d = firstDiff(JSON.parse(norm(tb)), JSON.parse(norm(ta))); } catch { d = "(not json)"; } assert.fail(`${door}: body — ${d}`); }
  }
});

test("a switched door whose store is gone answers the store's 503", async (t) => {
  if (skip) return t.skip(skip);
  for (const door of ["/residents", "/residents/wright", "/town", "/doorstep/wright"]) {
    const r = await fetch(offices["cut-off"].base + door);
    assert.equal(r.status, 503, door);
    assert.match((await r.json()).defect, /town index \(the store\) cannot be reached/, door);
  }
});

test("the MCP cases and household { read: address | window | home | doorstep | standing } answer the same both ways, and 503 when the store is gone", async (t) => {
  if (skip) return t.skip(skip);
  const { callTool } = await import("../src/mcp.mjs");
  const { householdApex } = await import("../src/household-apex.mjs");
  const KEY = { household: "keemin", handles: new Set(["wright"]) };
  const CTX = { db, meta, clone: join(tmp, "no-clone-here"), asOf: meta.as_of };
  const asks = [
    () => callTool("read_town", {}, { db, meta }),
    () => callTool("list_residents", { limit: 2 }, { db, meta }),
    () => callTool("read_resident", { handle: "Zed" }, { db, meta }),
    () => callTool("read_doorstep", { handle: "wright" }, { db, meta, asOf: meta.as_of }),
    () => householdApex({ read: "address", handle: "wright" }, KEY, CTX),
    () => householdApex({ read: "window", handle: "wright" }, KEY, CTX),
    () => householdApex({ read: "home", handle: "wright" }, KEY, CTX),
    () => householdApex({ read: "doorstep", handle: "wright" }, KEY, CTX),
    () => householdApex({ read: "standing" }, KEY, CTX),
  ];
  const keep = { TOWN_INDEX_READS: process.env.TOWN_INDEX_READS, WORLD2_PG: process.env.WORLD2_PG, WORLD2_PG_URL: process.env.WORLD2_PG_URL };
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: s.url("office_api"), max: 3 });
  const pen = await import("../src/world2-pen.mjs");
  try {
    // the store is reachable in both phases; only the switch differs
    Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") });
    pen.__setPoolForTest(pool);
    const plain = [];
    for (const ask of asks) plain.push(bytes(await ask()));
    process.env.TOWN_INDEX_READS = "store";
    for (const [i, ask] of asks.entries()) { const got = bytes(await ask()); if (got !== plain[i]) assert.fail(`ask ${i}: ${firstDiff(JSON.parse(got), JSON.parse(plain[i]))}`); }
    pen.__setPoolForTest({ connect: async () => { throw new Error("ECONNREFUSED"); } });
    for (const [i, ask] of asks.entries()) {
      const r = await ask();
      assert.match(String(r?.defect), /town index \(the store\) cannot be reached/, `ask ${i} with the store gone: ${JSON.stringify(r).slice(0, 160)}`);
    }
  } finally {
    pen.__setPoolForTest(null); await pool.end();
    for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test("the house and needs-you answer the same through the store's index", async (t) => {
  if (skip) return t.skip(skip);
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { houseBundle, needsYou } = await import("../src/house-bundle.mjs");
  const clone = join(tmp, "house-clone");
  mkdirSync(join(clone, "tools"), { recursive: true });
  writeFileSync(join(clone, "tools", "households.json"), JSON.stringify({ households: {
    keemin: { name: "Fixture", human: "FIX", accounts: [{ login: "fixture", id: 1 }], residents: ["wright", "limen", "Zed", "r-harbor"] },
  } }));
  // the world's reads, stubbed: they are not the index, and both sides get the same
  const readers = {
    stances: async (_h, opts) => ({ stances_awaiting: 0, awaiting: [], standing: [], cursor: null, complete: true, set_downs_awaiting: [], limit: opts.limit }),
    stakesFor: async () => ({ next_settlement: { at: "2026-07-15T00:00:00.000Z" }, count: 0, at_risk: 0, rows: [] }),
    walkers: async () => ({ at: 190.5, walkers: [] }),
    claimEffects: async () => ({ readable: true, store: "docket", events: [] }),
    claimState: async () => null,
    // the registry, injected: the store this suite stands up holds no households
    registry: { registry: { households: { keemin: { name: "Fixture", human: "FIX", accounts: [{ login: "fixture", id: 1 }], residents: ["wright", "limen", "Zed", "r-harbor"] } } }, pins: {} },
  };
  const key = { household: "keemin", handles: new Set(["wright", "limen"]) };
  const base = { db, key, meta, asOf: meta.as_of, clone, odb: null, nowMs: NOW, readers };
  const keep = { WORLD2_PG: process.env.WORLD2_PG, WORLD2_PG_URL: process.env.WORLD2_PG_URL };
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: s.url("office_api"), max: 3 });
  const pen = await import("../src/world2-pen.mjs");
  try {
    Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") });
    pen.__setPoolForTest(pool);
    const ix = store.storeIndexPooled(clone);
    const plainHouse = await houseBundle({ household: "keemin" }, base);
    assert.equal(plainHouse.read, "house", `a house, not a refusal: ${JSON.stringify(plainHouse).slice(0, 160)}`);
    assert.deepEqual(plainHouse.ashore, ["wright", "limen", "Zed"]);
    await same("houseBundle", houseBundle({ household: "keemin" }, base), houseBundle({ household: "keemin" }, { ...base, ix }));
    await same("needsYou", needsYou({ household: "keemin" }, base), needsYou({ household: "keemin" }, { ...base, ix }));
    pen.__setPoolForTest({ connect: async () => { throw new Error("ECONNREFUSED"); } });
    await assert.rejects(houseBundle({ household: "keemin" }, { ...base, ix: store.storeIndexPooled(clone) }), { name: "TownIndexUnreachable" },
      "the store gone is an error the door answers 503, never a house read from nothing");
  } finally {
    pen.__setPoolForTest(null); await pool.end();
    for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test("the roster memo follows the store's head: a new ingest's residents are on the roll", async (t) => {
  if (skip) return t.skip(skip);
  store.__resetRosterForTest();
  const before = (await store.residentList(api)).map((e) => e.handle);
  assert.ok(!before.includes("newcomer"));
  // what an ingest does: a new row, and the head moved (in the store only)
  const w = await s.connect("law_ingester");
  await w.query("INSERT INTO town_residents (handle, json, digest) VALUES ('newcomer', $1, 'x')", [JSON.stringify({ handle: "newcomer", address: { data: { joined: "2026-07-14" } } })]);
  await w.query("DELETE FROM town_meta WHERE key = 'as_of'");
  await w.query("INSERT INTO town_meta (key, value, digest) VALUES ('as_of', 'the-next-head', 'x')");
  await w.end();
  const after = (await store.residentList(api)).map((e) => e.handle);
  assert.ok(after.includes("newcomer"), "a moved head re-reads the cards once, and the roll has the newcomer");
});
