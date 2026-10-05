// town-index-writes.test.mjs — group 4 of POS-268: the write path's questions
// of the index (index-probe.mjs) answer from the store exactly as from office.db.
//
//   EMBEDDED_PG_DIR=<dir with embedded-postgres> node --test test/town-index-writes.test.mjs
//
// test/fixture.mjs's town plus what the ports had to get right: a handle the
// door could never admit (`_archived`), two handles bound to one GitHub login
// by the two spellings (the card's and the top level), a JSON-null `github`
// that falls through to the card's, an empty one that does not, and a pinned
// handle the roll does not hold (the harbor stamp). The store is seeded from
// the same office.db. Then: every check both ways, compared as what it answers
// or throws; the refusing probe; the out-of-process pens (join-bind-exec) over
// office.db, the store, and a store that is gone; and the keyless desks and
// POST /letters over two offices and one whose store is gone.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { fixtureDb, tempClone } from "./fixture.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { copyIndexToStore } from "./helpers/index-to-store.mjs";
import { officeProbe, holdStoreProbe, UNREACHABLE_DEFECT } from "../src/index-probe.mjs";
import { STANDING_UNREADABLE } from "../src/standing.mjs";
import * as store from "../src/town-index-store.mjs";
import { validateLetter } from "../src/write.mjs";
import { validateResidencyRequest } from "../src/residency.mjs";
import { handleTaken } from "../src/declare.mjs";
import { householdFor } from "../src/oauth.mjs";
import { threadlessReplyHint } from "../src/mail-thread.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(join(tmpdir(), "town-index-writes-"));
const dbPath = join(tmp, "office.db");
const KEY = "writes-test-key";
let s = null, skip = false, api, db, empty, rows, clone;
const offices = {};

before(async () => {
  s = await startStore();
  if (s.skip) { skip = s.skip; return; }
  db = fixtureDb(dbPath);
  const R = db.prepare("INSERT INTO residents VALUES (?, ?)");
  R.run("Zed", JSON.stringify({ handle: "Zed", address: { data: { joined: "2026-07-13", github: "Zed-GH" } } }));
  R.run("_archived", JSON.stringify({ handle: "_archived", address: { data: { joined: "2026-07-13" } } }));
  R.run("nullgh", JSON.stringify({ handle: "nullgh", github: null, address: { data: { github: "fallback" } } }));
  R.run("emptygh", JSON.stringify({ handle: "emptygh", github: "", address: { data: { github: "never-read" } } }));
  R.run("zed-two", JSON.stringify({ handle: "zed-two", github: "zed-gh", address: { data: {} } }));
  // rowid order made bytewise, as the vendored readTown's sorted listing makes it on a hydrated office.db
  const all = db.prepare("SELECT handle, json FROM residents").all().sort((a, b) => Buffer.compare(Buffer.from(a.handle), Buffer.from(b.handle)));
  db.exec("DELETE FROM residents");
  for (const r of all) R.run(r.handle, r.json);
  empty = fixtureDb(":memory:");
  for (const t of ["residents", "letters", "mail_state"]) empty.exec(`DELETE FROM ${t}`);
  const w = await s.connect("law_ingester");
  await copyIndexToStore(w, db);
  await w.end();
  api = await s.connect("office_api");
  rows = await store.probeRows(api);

  clone = tempClone();
  mkdirSync(join(clone, "tools"), { recursive: true });
  writeFileSync(join(clone, "tools", "github-ids.json"), JSON.stringify({ ghost: { id: 999 } }));

  for (const [name, env] of [["plain", { WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") }],
    ["switched", { TOWN_INDEX_READS: "store", WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") }],
    ["cut-off", { TOWN_INDEX_READS: "store", WORLD2_PG: "1", WORLD2_PG_URL: "postgres://office_api:x@127.0.0.1:9/none" }]]) {
    const child = spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", "0", "--db", dbPath,
      "--oauth-db", join(tmp, `${name}-oauth.db`), "--roles-db", join(tmp, `${name}-roles.db`)], {
      env: { ...process.env, TOWN_CLONE: clone, WORLD_CLONE: join(tmp, "no-world-clone"), VOICES_LOG: join(tmp, `${name}-voices.jsonl`),
        TOWN_PUSH: "", WORLD_STORE_DB: join(tmp, "no-world.db"), OFFICE_READ_WORKERS: "0", OFFICE_KEYS: `${KEY}=keemin:limen`,
        TOWN_INDEX_READS: undefined, WORLD2_PG: undefined, WORLD2_PG_URL: undefined, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise((ok, no) => {
      const t = setTimeout(() => no(new Error(`${name}: the office never listened`)), 20_000);
      child.stdout.on("data", (d) => { const m = /listening on :(\d+)/.exec(String(d)); if (m) { clearTimeout(t); offices[name] = { child, base: `http://127.0.0.1:${m[1]}` }; ok(); } });
      child.on("exit", (c) => no(new Error(`${name}: the office exited early (${c})`)));
    });
  }
  // the switched office loads its probe at boot; wait for it rather than race it
  for (let i = 0; i < 100; i++) {
    const r = await post("switched", "/keys/claim", { handle: "nobody" }); // the berth desk counts every ask against its hourly five
    if (r.status !== 503) break;
    await new Promise((ok) => setTimeout(ok, 100));
  }
});

after(async () => {
  for (const { child } of Object.values(offices)) if (child.exitCode === null) { const gone = new Promise((ok) => child.on("exit", ok)); child.kill(); await gone; }
  if (api) await api.end().catch(() => {});
  if (s?.stop) await s.stop();
  db?.close(); empty?.close();
  for (const d of [tmp, clone]) if (d) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function post(office, path, body, auth = null) {
  return fetch(offices[office].base + path, { method: "POST", body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${auth}` } : {}) } });
}

// what a check answers, or what it throws in the bounce vocabulary
const outcome = (fn) => {
  try { const v = fn(); return JSON.stringify(v instanceof Set ? [...v] : v, (k, x) => (x instanceof Set ? [...x] : x)); }
  catch (e) { return JSON.stringify({ threw: e?.code ?? e?.name, defect: e?.defect ?? e?.message, hint: e?.hint ?? null }); }
};

function withSwitch(probe, fn) {
  const keep = process.env.TOWN_INDEX_READS;
  process.env.TOWN_INDEX_READS = "store";
  holdStoreProbe(probe);
  try { return fn(); } finally { holdStoreProbe(null); if (keep === undefined) delete process.env.TOWN_INDEX_READS; else process.env.TOWN_INDEX_READS = keep; }
}

test("the store's probe answers every question as office.db's does", async (t) => {
  if (skip) return t.skip(skip);
  const off = officeProbe(db), st = store.probeOver(rows);
  const handles = db.prepare("SELECT handle FROM residents").all().map((r) => r.handle);
  for (const h of [...handles, "nobody", "WRIGHT", "zed", "", "wright "]) assert.equal(st.hasResident(h), off.hasResident(h), `hasResident ${JSON.stringify(h)}`);
  const ids = db.prepare("SELECT id FROM letters").all().map((r) => r.id);
  for (const id of [...ids, "nope", ids[0].toUpperCase(), `${ids[0]} `]) assert.equal(st.hasLetter(id), off.hasLetter(id), `hasLetter ${id}`);
  assert.deepEqual(st.loginRows(), off.loginRows(), "the GitHub lines, in the same order");
  const mail = new Map();
  for (const h of ["wright", "limen", "nobody"]) mail.set(h, (await api.query("SELECT json FROM town_mail_state WHERE handle = $1", [h])).rows[0]?.json ?? null);
  const withMail = store.probeOver(rows, { mail });
  for (const h of mail.keys()) assert.equal(withMail.mailStateJson(h), off.mailStateJson(h), `mail_state ${h}`);
  assert.match(st.loginStamp(), /^store:/, "the login memo keys on the store's head");
});

// Each check, as a door calls it. `ix` is office.db, or (switched) a db with no rows
// at all: the switched answers can only have come from the store.
const LIMEN = { household: "keemin", handles: new Set(["limen"]) };
const RETURN = { id: "limen-2026-07-03-to-wright-the-return", file: "WHITE_PAGES/limen/outbox/letter-2026-07-03-to-wright-the-return.md" };
const checks = (ix) => [
  () => validateLetter({ from: "limen", to: "nobody", title: "Hi", body: "x" }, LIMEN, ix),
  () => validateLetter({ from: "limen", to: "wright", title: "Hi", body: "x", thread: "no-such-letter" }, LIMEN, ix),
  () => validateLetter({ from: "limen", to: "wright", title: "Hi", body: "x", thread: "limen-2026-07-01-to-wright-the-gap" }, LIMEN, ix),
  () => validateLetter({ from: "limen", to: "wright", title: "The return", body: "x", thread: "new" }, LIMEN, ix, RETURN),
  () => validateLetter({ from: "limen", to: "Zed", title: "Hi", body: "x" }, LIMEN, ix),
  () => validateResidencyRequest({ handle: "wright", card: "me" }, ix),
  () => validateResidencyRequest({ handle: "Nullgh", card: "me" }, ix),
  () => validateResidencyRequest({ handle: "newcomer", card: "me" }, ix),
  () => handleTaken("zed-two", { db: ix, registry: null, clone }),
  () => handleTaken("newcomer", { db: ix, registry: null, clone }),
  () => householdFor(clone, ix, 1, "ZED-gh"),
  () => householdFor(clone, ix, 2, "keeminlee"),
  () => householdFor(clone, ix, 3, "fallback"),
  () => householdFor(clone, ix, 4, "never-read"),
  () => householdFor(clone, ix, 999, null),
  () => householdFor(clone, ix, 5, "stranger"),
];

test("every check answers the same over the store as over office.db", async (t) => {
  if (skip) return t.skip(skip);
  const plain = checks(db).map(outcome);
  assert.ok(plain.some((o) => o.includes('"threw":409')) && plain.some((o) => o.includes('"threw":422')), "the asks exercise both refusals");
  assert.ok(plain.some((o) => o.includes('"harbor":true')), "and the harbor stamp");
  const switched = withSwitch(store.probeOver(rows), () => checks(empty).map(outcome));
  for (const [i, o] of plain.entries()) assert.equal(switched[i], o, `check ${i}`);
  // the reply hint, off the row the send read
  const mail = new Map([["wright", (await api.query("SELECT json FROM town_mail_state WHERE handle = 'wright'")).rows[0].json]]);
  const hint = threadlessReplyHint(db, { from: "wright", to: "limen" });
  assert.ok(hint, "the fixture's wright has an unanswered letter from limen");
  assert.equal(withSwitch(store.probeOver(rows), () => threadlessReplyHint(store.probeOver(rows, { mail }), { from: "wright", to: "limen" })), hint);
});

test("switched with no snapshot, every check refuses with the store's 503, and the hint says nothing", async (t) => {
  if (skip) return t.skip(skip);
  const outs = withSwitch(null, () => checks(db).map(outcome));
  for (const [i, o] of outs.entries()) {
    if (i === 14) continue; // below
    const r = JSON.parse(o);
    assert.equal(r.threw, 503, `check ${i}: ${o}`);
    assert.equal(r.defect, UNREACHABLE_DEFECT, `check ${i}`);
  }
  // a pinned household whose settled test cannot be read is never stamped harbor: an unreadable index never widens the gate
  assert.equal(outs[14], JSON.stringify({ household: "999", handles: ["ghost"] }));
  assert.equal(withSwitch(null, () => threadlessReplyHint(db, { from: "wright", to: "limen" })), null);
  assert.equal(await store.refreshStoreProbe({ env: { WORLD2_PG: "1", WORLD2_PG_URL: "postgres://office_api:x@127.0.0.1:9/none" } }), false);
});

test("a send draws the same reply hint from the store's row, and a store gone after the send only loses the hint", async (t) => {
  if (skip) return t.skip(skip);
  const { sendAtDoor } = await import("../src/send-at-door.mjs");
  const WRIGHT = { household: "keemin", handles: new Set(["wright"]) };
  const send = (title) => sendAtDoor({ from: "wright", to: "limen", title, body: "x" }, WRIGHT, { db, clone, odb: null });
  const plain = (await send("Plain ask")).result;
  assert.ok(plain.hint, "the office.db send carries the hint");
  const keep = { TOWN_INDEX_READS: process.env.TOWN_INDEX_READS, WORLD2_PG: process.env.WORLD2_PG, WORLD2_PG_URL: process.env.WORLD2_PG_URL };
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: s.url("office_api"), max: 2 });
  const pen = await import("../src/world2-pen.mjs");
  try {
    Object.assign(process.env, { TOWN_INDEX_READS: "store", WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") });
    pen.__setPoolForTest(pool);
    assert.equal(await store.refreshStoreProbe(), true);
    const switched = (await send("Switched ask")).result;
    assert.equal(switched.hint, plain.hint);
    pen.__setPoolForTest({ connect: async () => { throw new Error("ECONNREFUSED"); } });
    const gone = (await send("Gone ask")).result;
    assert.ok(gone.letter_id, "the letter went");
    assert.equal(gone.hint, undefined, "and no hint rode it");
  } finally {
    pen.__setPoolForTest(null); await pool.end(); holdStoreProbe(null);
    for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

function joinBind(env) {
  const payload = JSON.stringify({ args: { handle: "wright", card: "me" }, key: { ghId: 7, ghLogin: "someone", handles: [] }, dbPath });
  const r = spawnSync(process.execPath, [join(ROOT, "src", "join-bind-exec.mjs"), payload], {
    env: { ...process.env, TOWN_CLONE: clone, TOWN_PUSH: "", TOWN_INDEX_READS: undefined, ...env }, encoding: "utf8", timeout: 30_000 });
  return JSON.parse(r.stdout.trim().split("\n").pop());
}

test("the join pen reads the store under the lock when switched, and refuses when it is gone", async (t) => {
  if (skip) return t.skip(skip);
  const pg = { WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") };
  const plain = joinBind(pg);
  assert.equal(plain.error?.code, 409, JSON.stringify(plain));
  assert.deepEqual(joinBind({ ...pg, TOWN_INDEX_READS: "store", OFFICE_DB: join(tmp, "no-office.db") }), plain);
  const gone = joinBind({ TOWN_INDEX_READS: "store", WORLD2_PG: "1", WORLD2_PG_URL: "postgres://office_api:x@127.0.0.1:9/none" });
  assert.equal(gone.error?.code, 503, JSON.stringify(gone));
  assert.equal(gone.error?.defect, UNREACHABLE_DEFECT);
});

test("the drain stops before a row when the store cannot answer, and never opens office.db", async (t) => {
  if (skip) return t.skip(skip);
  const r = spawnSync(process.execPath, [join(ROOT, "tools", "town-drain-run.mjs"), "--clone", clone, "--db", dbPath, "--oauth-db", join(tmp, "drain-oauth.db"), "--dry-run"], {
    env: { ...process.env, TOWN_INDEX_READS: "store", WORLD2_PG: "1", WORLD2_PG_URL: "postgres://office_api:x@127.0.0.1:9/none" }, encoding: "utf8", timeout: 30_000 });
  assert.equal(r.status, 1, r.stderr);
  assert.ok(r.stderr.includes(UNREACHABLE_DEFECT), r.stderr);
});

const ASKS = [
  ["/berth", { slug: "wright" }],
  ["/berth", { slug: "zed-two" }],
  ["/keys/claim", { handle: "nobody" }],
  ["/letters", { from: "limen", to: "nobody", title: "Hi", body: "x" }, KEY],
  ["/letters", { from: "limen", to: "wright", title: "Hi", body: "x", thread: "no-such-letter" }, KEY],
];

test("the keyless desks and POST /letters answer the switched office exactly as the unswitched one", async (t) => {
  if (skip) return t.skip(skip);
  for (const [path, body, auth] of ASKS) {
    const a = await post("plain", path, body, auth), b = await post("switched", path, body, auth);
    assert.equal(b.status, a.status, `${path} ${JSON.stringify(body)}: status`);
    assert.equal(await b.text(), await a.text(), `${path} ${JSON.stringify(body)}: body`);
  }
});

test("a door whose store is gone answers the store's 503", async (t) => {
  if (skip) return t.skip(skip);
  for (const [path, body, auth] of ASKS) {
    const r = await post("cut-off", path, body, auth);
    assert.equal(r.status, 503, `${path} ${JSON.stringify(body)}`);
    // A KEYED write meets the standing gate first (POS-347): standing is read
    // from the same store before any write, so its 503 is the store's 503 and
    // says nothing was written. The keyless desks never reach that gate.
    assert.equal((await r.json()).defect, auth ? STANDING_UNREADABLE.defect : UNREACHABLE_DEFECT, path);
  }
});
