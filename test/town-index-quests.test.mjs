// town-index-quests.test.mjs — group 1 of POS-268: the pots and the quest
// boards answer from the store exactly as from office.db.
//
//   EMBEDDED_PG_DIR=<dir with embedded-postgres> node --test test/town-index-quests.test.mjs
//
// One office.db, built here, holds three pots (a roll, receipts with a tie on
// date, escrow with a tie on stake, an invalid funding row), quest progress for
// today and yesterday's shape, and a standing row. The store is seeded from that
// same file (helpers/index-to-store.mjs), so the readers are the only thing that
// can differ. Each reader and each door that reads through them is compared as
// the bytes it sends: potBoard, standingFor, questBoardFor (a resident's and the
// town's), household-stamps' three reads, GET /quests/{h} and read_quests. The
// quest tools are the pinned town clone's own (fixture-paths.mjs); without the
// clone or without a Postgres the file SKIPS and says which.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { fixtureDb } from "./fixture.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { copyIndexToStore } from "./helpers/index-to-store.mjs";
import { townClone, townModuleUrl } from "./fixture-paths.mjs";
import * as office from "../src/queries.mjs";
import * as store from "../src/town-index-store.mjs";
import { estateRead, questsRead, fundRead, fundReadOf } from "../src/household-stamps.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TOWN = townClone();
const tmp = mkdtempSync(join(tmpdir(), "town-index-quests-"));
const dbPath = join(tmp, "office.db");
let s = null, skip = TOWN ? false : "no town clone beside the office: the quest board reads the town's own tools from it";
let api, db, meta;
const offices = {};

before(async () => {
  if (skip) return;
  s = await startStore();
  if (s.skip) { skip = s.skip; return; }
  const { townDay } = await import(townModuleUrl("tools", "quest-progress.mjs"));
  db = fixtureDb(dbPath);
  const put = db.prepare("INSERT OR REPLACE INTO meta VALUES (?, ?)");
  put.run("quest_registry", readFileSync(join(TOWN, "quest-registry.json"), "utf8"));
  put.run("quest_day", townDay());
  const qp = db.prepare("INSERT INTO quest_progress (handle, send, receive, house_size, house_send, house_receive, sent_to, heard_from) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  qp.run("wright", 2, 1, 1, 2, 1, JSON.stringify(["limen", "errant"]), JSON.stringify(["limen"]));
  qp.run("limen", 0, 3, 2, 1, 3, "not json", null);
  db.prepare("INSERT INTO quest_standing VALUES (?, ?)").run("wright", JSON.stringify({ facts: { address: true, home: true }, since: { "first-letter-out": "2026-07-02" } }));
  const pot = db.prepare("INSERT INTO pots VALUES (?, ?)");
  pot.run("darko-fund", JSON.stringify({ title: "Darko's fund", beneficiary: "keeminlee", target_usd_per_epoch: 100, received_usd: 40, epoch_cadence: "monthly", status: "open", close: "epoch", first_close: "2026-10-31" }));
  pot.run("Keeping", JSON.stringify({ title: "Keeping", beneficiary: "the-town", target_usd_per_epoch: 0, status: "open", close: "elastic", min_close_usd: 5 }));
  pot.run("a-closed-pot", JSON.stringify({ title: "Closed", beneficiary: "wright", status: "closed" }));
  const rc = db.prepare("INSERT INTO pot_receipts (pot, rail, usd, date, receipt, payer) VALUES (?, ?, ?, ?, ?, ?)");
  rc.run("darko-fund", "stripe", 25, "2026-09-02", "cs_b", "wright");
  rc.run("darko-fund", "paypal", 15.5, "2026-09-02", "pp_a", "limen");
  rc.run("darko-fund", "usdc", 10, "2026-09-01", "0xabc", "limen");
  const roll = db.prepare("INSERT INTO funding_roll (patron, pot, usd, date, receipt, holo) VALUES (?, ?, ?, ?, ?, ?)");
  roll.run("wright", "darko-fund", 25, "2026-09-02", "cs_b", 3);
  db.prepare("INSERT INTO pot_escrow VALUES (?, ?)").run("darko-fund", 9);
  const sk = db.prepare("INSERT INTO pot_stakers VALUES (?, ?, ?)");
  sk.run("darko-fund", "wright", 3); sk.run("darko-fund", "Zed", 3); sk.run("darko-fund", "limen", 3);
  db.prepare("INSERT INTO funding_invalid (row_kind, line, reason) VALUES (?, ?, ?)").run("pot-file", "WHITE_PAGES/pot-bad.json", "unparseable JSON");
  meta = Object.fromEntries(db.prepare("SELECT key, value FROM meta").all().map((r) => [r.key, r.value]));
  const w = await s.connect("law_ingester");
  await copyIndexToStore(w, db);
  await w.end();
  api = await s.connect("office_api");

  // the door, both ways, over the same office.db
  for (const [name, env] of [["plain", {}], ["switched", { TOWN_INDEX_READS: "store", WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") }],
    ["cut-off", { TOWN_INDEX_READS: "store", WORLD2_PG: "1", WORLD2_PG_URL: "postgres://office_api:x@127.0.0.1:9/none" }]]) {
    const child = spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", "0", "--db", dbPath,
      "--oauth-db", join(tmp, `${name}-oauth.db`), "--roles-db", join(tmp, `${name}-roles.db`)], {
      env: { ...process.env, TOWN_CLONE: TOWN, WORLD_CLONE: join(tmp, "no-world-clone"), VOICES_LOG: join(tmp, `${name}-voices.jsonl`),
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

// the bytes a door sends, key order included
const same = async (label, oldAnswer, newAnswer) => assert.equal(JSON.stringify(await newAnswer), JSON.stringify(await oldAnswer), label);

test("potBoard and standingFor answer as office.db does", async (t) => {
  if (skip) return t.skip(skip);
  await same("potBoard", office.potBoard(db), store.potBoard(api));
  const extra = [{ row_kind: "pot-posting", line: "quest-registry.json § ghost", reason: "no pot" }];
  await same("potBoard with extra invalid rows", office.potBoard(db, extra), store.potBoard(api, extra));
  for (const h of ["wright", "limen", "nobody"]) await same(`standingFor ${h}`, office.standingFor(db, h), store.standingFor(api, h));
});

test("questBoardFor answers as office.db does, for a resident and for the town", async (t) => {
  if (skip) return t.skip(skip);
  for (const h of ["wright", "limen", "nobody", null, ""])
    await same(`questBoardFor ${JSON.stringify(h)}`, office.questBoardFor(db, meta, h, TOWN, { worldSited: null }), store.questBoardFor(api, h, TOWN, { worldSited: null }));
});

test("household-stamps' estate, quests and fund reads answer the same through either index", async (t) => {
  if (skip) return t.skip(skip);
  const ix = store.storeIndex(api, TOWN);
  const key = { household: "keemin", handles: new Set(["wright", "limen"]) };
  await same("estateRead", estateRead(key, { db, meta, clone: TOWN }), estateRead(key, { db, meta, clone: TOWN, ix }));
  for (const h of ["wright", null]) await same(`questsRead ${h}`, questsRead(h, { db, meta, clone: TOWN }), questsRead(h, { db, meta, clone: TOWN, ix }));
  await same("fundRead", fundRead(null, { db, stripeUrl: "https://buy.stripe.com/x" }),
    (async () => fundReadOf((await ix.potBoard()).list, { stripeUrl: "https://buy.stripe.com/x" }))());
});

test("GET /quests/{h} and read_quests answer the switched office exactly as the unswitched one", async (t) => {
  if (skip) return t.skip(skip);
  for (const door of ["/quests/wright", "/quests/limen", "/quests/nobody"]) {
    const a = await fetch(offices.plain.base + door), b = await fetch(offices.switched.base + door);
    assert.equal(b.status, a.status, `${door}: status`);
    const [ta, tb] = [await a.text(), await b.text()];
    // `today` carries the town clock's live minutes; everything else must be the same bytes
    const norm = (x) => { const o = JSON.parse(x); if (o.today) o.today = { day: o.today.day }; return JSON.stringify(o); };
    assert.equal(norm(tb), norm(ta), `${door}: body`);
    assert.equal(b.headers.get("x-postmark-town-index-as-of"), "fixturesha000000000000000000000000000000", `${door}: names the index it read`);
  }
});

test("a switched /quests/{h} whose store is gone answers the store's 503, never office.db's board", async (t) => {
  if (skip) return t.skip(skip);
  const r = await fetch(offices["cut-off"].base + "/quests/wright");
  assert.equal(r.status, 503);
  assert.match((await r.json()).defect, /town index \(the store\) cannot be reached/);
});

test("read_quests through callTool answers the same both ways", async (t) => {
  if (skip) return t.skip(skip);
  const { callTool } = await import("../src/mcp.mjs");
  const keep = { TOWN_INDEX_READS: process.env.TOWN_INDEX_READS, WORLD2_PG: process.env.WORLD2_PG, WORLD2_PG_URL: process.env.WORLD2_PG_URL };
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: s.url("office_api"), max: 2 });
  const pen = await import("../src/world2-pen.mjs");
  try {
    const norm = (o) => { const c = structuredClone(o); if (c?.today) c.today = { day: c.today.day }; return JSON.stringify(c); };
    const plain = [];
    for (const h of ["wright", null]) plain.push(norm(await callTool("read_quests", { handle: h }, { db, meta, clone: TOWN })));
    Object.assign(process.env, { TOWN_INDEX_READS: "store", WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") });
    pen.__setPoolForTest(pool);
    for (const [i, h] of ["wright", null].entries())
      assert.equal(norm(await callTool("read_quests", { handle: h }, { db, meta, clone: TOWN })), plain[i], `read_quests ${h}`);
  } finally {
    pen.__setPoolForTest(null); await pool.end();
    for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test("household { read: stamps | quests | fund } answers through the store when switched, and 503s when the store is gone", async (t) => {
  if (skip) return t.skip(skip);
  const { householdApex } = await import("../src/household-apex.mjs");
  const KEY = { household: "keemin", handles: new Set(["wright", "limen"]) };
  const CTX = { db, meta, clone: TOWN, asOf: "fixture" };
  const asks = [{ read: "stamps" }, { read: "quests", handle: "wright" }, { read: "fund" }];
  const keep = { TOWN_INDEX_READS: process.env.TOWN_INDEX_READS, WORLD2_PG: process.env.WORLD2_PG, WORLD2_PG_URL: process.env.WORLD2_PG_URL };
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: s.url("office_api"), max: 2 });
  const pen = await import("../src/world2-pen.mjs");
  const norm = (o) => { const c = structuredClone(o); if (c?.today) c.today = { day: c.today.day }; return JSON.stringify(c); };
  try {
    const plain = [];
    for (const a of asks) plain.push(norm(await householdApex(a, KEY, CTX)));
    Object.assign(process.env, { TOWN_INDEX_READS: "store", WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") });
    pen.__setPoolForTest(pool);
    for (const [i, a] of asks.entries()) assert.equal(norm(await householdApex(a, KEY, CTX)), plain[i], `household ${JSON.stringify(a)}`);
    // the store gone: a pool whose every connect fails
    pen.__setPoolForTest({ connect: async () => { throw new Error("ECONNREFUSED"); } });
    for (const a of asks) {
      const r = await householdApex(a, KEY, CTX);
      assert.equal(r.code, 503, `household ${JSON.stringify(a)}: ${JSON.stringify(r).slice(0, 160)}`);
      assert.match(r.defect, /town index \(the store\) cannot be reached/);
    }
  } finally {
    pen.__setPoolForTest(null); await pool.end();
    for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test("a switched reader that throws is answered with a 500, and the office stays up", async (t) => {
  if (skip) return t.skip(skip);
  // a bent row in the STORE only (a region no other answer here reads)
  const w = await s.connect("law_ingester");
  await w.query("INSERT INTO town_regions (id, name, json, digest) VALUES ('bent-region', 'Bent', 'not json', 'x')");
  await w.end();
  const r = await fetch(offices.switched.base + "/regions");
  assert.equal(r.status, 500, "the reader's own error is the office's 500, not an unanswered rejection");
  assert.match((await r.json()).defect, /tripped reading the town index/);
  assert.equal((await fetch(offices.switched.base + "/quests/wright")).status, 200, "and the office is still answering");
});
