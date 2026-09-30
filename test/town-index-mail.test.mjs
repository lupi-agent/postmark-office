// town-index-mail.test.mjs — group 2 of POS-268: letters and mail answer from
// the store exactly as from office.db.
//
//   EMBEDDED_PG_DIR=<dir with embedded-postgres> node --test test/town-index-mail.test.mjs
//
// test/fixture.mjs's town plus the letters the ports had to get right: two
// letters delivered at the same instant (the id breaks the tie, bytewise), a
// bare-date letter beside a timestamped one on the same day, a letter to three
// recipients (toList), an office resident, a letter whose body names a word in
// capitals (search folds ASCII case, and only ASCII), and a `%` in a body. The
// store is seeded from that same office.db, so the readers are all that can
// differ; every answer is compared as the bytes a door sends. Then the doors:
// the REST routes over two offices (switch off and on) and one whose store is
// gone, the MCP cases through callTool, and household { read: "mail" | "letter" }.

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

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(join(tmpdir(), "town-index-mail-"));
const dbPath = join(tmp, "office.db");
let s = null, skip = false, api, db;
const offices = {};

before(async () => {
  s = await startStore();
  if (s.skip) { skip = s.skip; return; }
  db = fixtureDb(dbPath);
  const L = db.prepare("INSERT INTO letters VALUES (?,?,?,?,?,?,?,?,?,?)");
  const letter = (id, from, to, date, at, extra = {}, box = "inbox") =>
    L.run(id, from, to, date, null, box, to, `WHITE_PAGES/${to}/${box}/${id}.md`,
      JSON.stringify({ id, from, to, date, box, body: extra.body ?? `# ${id}\n\nA sentence.`, ...(at ? { delivered_at: at } : {}), ...extra }), at);
  letter("zed-2026-07-10-to-wright-b", "Zed", "wright", "2026-07-10", "2026-07-10T08:00:00.000Z");
  letter("zed-2026-07-10-to-wright-A", "Zed", "wright", "2026-07-10", "2026-07-10T08:00:00.000Z");
  letter("limen-2026-07-10-to-wright-bare", "limen", "wright", "2026-07-10", null, { body: "Bare day, 100% sure." });
  letter("wright-2026-07-11-to-many", "wright", "limen", "2026-07-11", "2026-07-11T09:00:00.000Z",
    { toList: ["limen", "Zed", "postmaster"], body: "To three of you. The LAMPLIGHT holds." });
  letter("wright-2026-07-12-unsent", "wright", "Zed", "2026-07-12", null, {}, "outbox");
  db.prepare("INSERT INTO residents VALUES (?, ?)").run("Zed", JSON.stringify({ handle: "Zed", is_office: false, address: { data: {}, body: "# Zed, of the Lamplight" } }));
  db.prepare("INSERT INTO mail_state VALUES (?, ?)").run("limen", JSON.stringify({
    handle: "limen", conversations: [], summary: { they_spoke_last: 0 },
    unplaced_bounces: [{ date: "2026-07-01", path: "WHITE_PAGES/limen/outbox/x.md", defect: "no such resident" }, { date: "2026-07-09", path: "y", defect: "late" }],
  }));
  const G = db.prepare("INSERT INTO ledger (kind, date, id, from_h, to_h, json) VALUES (?,?,?,?,?,?)");
  G.run("delivery", "2026-07-10", "zed-2026-07-10-to-wright-b", "Zed", "wright", "{}");
  G.run("bounce", "2026-07-10", null, "limen", null, "{}");
  const w = await s.connect("law_ingester");
  await copyIndexToStore(w, db);
  await w.end();
  api = await s.connect("office_api");

  for (const [name, env] of [["plain", {}], ["switched", { TOWN_INDEX_READS: "store", WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") }],
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

const same = async (label, oldAnswer, newAnswer) => assert.equal(JSON.stringify(await newAnswer), JSON.stringify(await oldAnswer), label);
const IDS = ["limen-2026-07-01-to-wright-the-gap", "wright-2026-07-11-to-many", "wright-2026-07-12-unsent", "nope"];

test("letter, letterAnswer and outboxSettled answer as office.db does", async (t) => {
  if (skip) return t.skip(skip);
  for (const id of IDS) {
    await same(`letter ${id}`, office.letter(db, id), store.letter(api, id));
    await same(`letterAnswer ${id}`, office.letterAnswer(db, id), store.letterAnswer(api, id));
  }
  for (const h of ["wright", "Zed", "nobody"]) await same(`outboxSettled ${h}`, office.outboxSettled(db, h), store.outboxSettled(api, h));
});

test("mailList answers as office.db does, in either box, on every page", async (t) => {
  if (skip) return t.skip(skip);
  for (const h of ["wright", "limen", "Zed", "nobody"])
    for (const box of ["inbox", "outbox"])
      for (const o of [{}, { limit: 1 }, { limit: 2, offset: 1 }, { since: "2026-07-10" }, { until: "2026-07-03" }, { since: "2026-07-05", until: "2026-07-10", limit: 1, offset: 1 }])
        await same(`mailList ${h} ${box} ${JSON.stringify(o)}`, office.mailList(db, h, box, o), store.mailList(api, h, box, o));
});

test("letterList answers as office.db does, under every filter", async (t) => {
  if (skip) return t.skip(skip);
  const asks = [{}, { limit: 2 }, { limit: 2, offset: 2 }, { resident: "wright" }, { resident: "Zed", full: true }, { region: "the-terrace" },
    { region: "the Trueing Terrace" }, { region: "nowhere" }, { since: "2026-07-05" }, { until: "2026-07-02" }, { excludeOffice: true },
    { excludeOffice: true, resident: "limen", full: true }, { limit: "x", offset: -3 }];
  for (const a of asks) await same(`letterList ${JSON.stringify(a)}`, office.letterList(db, a), store.letterList(api, a));
});

test("mailCorrespondents and mailAwaiting answer as office.db does", async (t) => {
  if (skip) return t.skip(skip);
  for (const h of ["wright", "limen", "Zed", "postmaster", "nobody"])
    for (const o of [{}, { limit: 1 }, { limit: 1, offset: 1 }])
      await same(`mailCorrespondents ${h} ${JSON.stringify(o)}`, office.mailCorrespondents(db, h, o), store.mailCorrespondents(api, h, o));
  for (const h of ["wright", "limen", "nobody"])
    for (const o of [{}, { limit: 1 }, { offset: 1 }, { hide_bounces_older_than_days: 3 }, { hide_bounces_older_than_days: 0 }])
      await same(`mailAwaiting ${h} ${JSON.stringify(o)}`, office.mailAwaiting(db, h, o), store.mailAwaiting(api, h, o));
});

test("search and metricsMail answer as office.db does", async (t) => {
  if (skip) return t.skip(skip);
  for (const [q, o] of [["gap", {}], ["WRIGHT", {}], ["lamplight", {}], ["100%", {}], ["zed", { limit: 1 }], ["zed", { limit: 1, offset: 1 }], ["_", {}], ["nothing-matches", {}], ["a", { limit: 2, offset: 3 }]])
    await same(`search ${q} ${JSON.stringify(o)}`, office.search(db, q, o), store.search(api, q, o));
  for (const o of [{}, { days: 7 }, { days: 1 }, { days: 400 }]) await same(`metricsMail ${JSON.stringify(o)}`, office.metricsMail(db, o), store.metricsMail(api, o));
});

const DOORS = ["/letters", "/letters?resident=wright&limit=2", "/letters?region=the-terrace&full=1", "/letters?exclude-office=1",
  "/letters/wright-2026-07-11-to-many", "/letters/nope", "/mail/wright", "/mail/wright?box=outbox", "/mail/Zed?limit=1&offset=1",
  "/search?q=lamplight", "/search?q=WRIGHT&limit=1", "/metrics/mail"];

test("every moved REST door answers the switched office exactly as the unswitched one", async (t) => {
  if (skip) return t.skip(skip);
  for (const door of DOORS) {
    const a = await fetch(offices.plain.base + door), b = await fetch(offices.switched.base + door);
    assert.equal(b.status, a.status, `${door}: status`);
    assert.equal(await b.text(), await a.text(), `${door}: body`);
    if (a.status === 200) assert.equal(b.headers.get("x-postmark-town-index-as-of"), "fixturesha000000000000000000000000000000", `${door}: names the index it read`);
  }
});

test("a switched door whose store is gone answers the store's 503", async (t) => {
  if (skip) return t.skip(skip);
  for (const door of ["/letters", "/letters/wright-2026-07-11-to-many", "/mail/wright", "/search?q=gap", "/metrics/mail"]) {
    const r = await fetch(offices["cut-off"].base + door);
    assert.equal(r.status, 503, door);
    assert.match((await r.json()).defect, /town index \(the store\) cannot be reached/, door);
  }
});

test("the MCP cases and household { read: mail | letter } answer the same both ways, and 503 when the store is gone", async (t) => {
  if (skip) return t.skip(skip);
  const { callTool } = await import("../src/mcp.mjs");
  const { householdApex } = await import("../src/household-apex.mjs");
  const meta = Object.fromEntries(db.prepare("SELECT key, value FROM meta").all().map((r) => [r.key, r.value]));
  const KEY = { household: "keemin", handles: new Set(["wright"]) };
  const CTX = { db, meta, clone: join(tmp, "no-clone-here"), asOf: meta.as_of };
  const asks = [
    () => callTool("list_mail", { handle: "wright" }, { db, meta }),
    () => callTool("list_mail", { handle: "wright", box: "outbox" }, { db, meta }),
    () => callTool("read_letter", { id: "wright-2026-07-11-to-many" }, { db, meta }),
    () => callTool("search_town", { q: "gap" }, { db, meta }),
    () => callTool("list_letters", { resident: "Zed", full: true }, { db, meta }),
    () => householdApex({ read: "mail", handle: "wright" }, KEY, CTX),
    () => householdApex({ read: "mail", handle: "wright", view: "outbox" }, KEY, CTX),
    () => householdApex({ read: "mail", handle: "wright", view: "awaiting" }, KEY, CTX),
    () => householdApex({ read: "mail", handle: "wright", view: "correspondents" }, KEY, CTX),
    () => householdApex({ read: "letter", id: "wright-2026-07-11-to-many" }, KEY, CTX),
  ];
  const keep = { TOWN_INDEX_READS: process.env.TOWN_INDEX_READS, WORLD2_PG: process.env.WORLD2_PG, WORLD2_PG_URL: process.env.WORLD2_PG_URL };
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: s.url("office_api"), max: 2 });
  const pen = await import("../src/world2-pen.mjs");
  try {
    const plain = [];
    for (const ask of asks) plain.push(JSON.stringify(await ask()));
    Object.assign(process.env, { TOWN_INDEX_READS: "store", WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") });
    pen.__setPoolForTest(pool);
    for (const [i, ask] of asks.entries()) assert.equal(JSON.stringify(await ask()), plain[i], `ask ${i}`);
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

test("a switched reader that throws is answered with a 500, and the office stays up", async (t) => {
  if (skip) return t.skip(skip);
  // a bent row in the STORE only, so no other answer here reads it
  const w = await s.connect("law_ingester");
  await w.query("INSERT INTO town_letters (id, json, digest) VALUES ('bent-1', 'not json', 'x')");
  await w.end();
  const r = await fetch(offices.switched.base + "/letters/bent-1");
  assert.equal(r.status, 500, "the reader's own error is the office's 500");
  assert.match((await r.json()).defect, /tripped reading the town index/);
  assert.equal((await fetch(offices.switched.base + "/letters?limit=1")).status, 500, "a list that meets the bent row trips the same way");
  assert.equal((await fetch(offices.switched.base + "/mail/limen")).status, 200, "and the office is still answering");
});
