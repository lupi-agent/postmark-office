// read-workers.test.mjs — POS-266's two falsifiers, against real workers.
//
//   § 1  A WRITE, THEN AN IMMEDIATE READ ON A WORKER, SEES THE WRITE. The walk
//        door's own call (`world.mjs § recordMoved`) runs on this thread, and
//        the very next /world/walkers, answered by each worker, must place the
//        walker where the write put her. The workers never walked: the only way
//        they can know is the announcement.
//   § 2  KILL A WORKER AND THE OFFICE KEEPS ANSWERING. A read held by a worker
//        that dies is answered by another; reads after the death are answered;
//        the dead worker is respawned, a new thread in its slot.
//
// The workers are the pool the server starts (read-workers.mjs § startReadPool)
// running the real server module as read-role offices; this file plays the
// main thread's part, handing them requests the way server.mjs's dispatch does.
//
//   § 3  AN AGENT'S MCP READ IS ANSWERED BY A WORKER (POS-284), and a call
//        that is not one of those reads is refused by the worker even when it
//        is handed over.
//   § 4  THE MAIN THREAD HANDS THOSE READS OVER, AND ONLY THOSE: a real office
//        with one worker answers world_orient from the worker and a say from
//        its own thread.
//   § 5  THE REST LISTEN STAYS HOME TOO (POS-284's hotfix): GET
//        /world/apex?read=say, after a say on the main thread, is answered by
//        the main thread and hears it; the bare GET /world/apex still goes to
//        the worker.
//
// THE FLIPS: delete `onAnnounce("position", …)` in world.mjs and § 1 goes red;
// delete the in-flight hand-over in `startReadPool`'s exit handler and § 2's
// first leg answers 503; delete the respawn and its last leg times out. For
// POS-284: drop `&& !(IN_READ_WORKER && req.handedMcpRead && path === "/mcp")`
// from server.mjs's role gate and § 3's reads answer the role's 405; delete the
// `onlyReads` refusal in mcp.mjs and § 3's say is answered by the worker; make
// `mcpWorkerTakes` answer true for every call and § 4's say names a worker.
// For the hotfix: drop `&& !listensToVoices(path, query)` from `workerTakes`, or
// the `url.searchParams` server.mjs passes it, and § 5's listen names worker-0
// and misses the say.
//
//   § 6  READING BACK STAYS HOME TOO (POS-226): a `before:` page of the REST
//        listen is answered by the main thread, and at the door a voice from
//        before the world clone's newest settlement is never heard while the
//        voices since it page back twenty at a time. FLIPS: drop
//        `&& !listensToVoices(path, query)` from `workerTakes` and the page names
//        worker-0; drop the window filter in voices.mjs § snapshot and the older
//        voice is heard.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { fixtureDb } from "./fixture.mjs";
import { mcpWorkerTakes, startReadPool, workerTakes } from "../src/read-workers.mjs";
import { WORLD_CLONE } from "../src/world-store.mjs";
import { publishedSettlementAt } from "../src/hearing-window.mjs";
import { writeFileSync } from "node:fs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const haveClone = existsSync(join(WORLD_CLONE, "WORLD", "walk-ledger.md"));

let tmp, pool;
const KEY = "read-workers-test-key";
const FLAGS = { WORLD_POSITIONS: "1", WORLD_MOVEMENT_V2: "1", WORLD_PRESENCE: "1" };
const was = Object.fromEntries(Object.keys(FLAGS).map((k) => [k, process.env[k]]));

/** Hand one GET to the pool, the way server.mjs does, and collect the answer. */
function read(url) {
  return new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error(`${url} was never answered`)), 180_000);
    const res = {
      writableEnded: false, destroyed: false, status: null, headers: null,
      writeHead(status, _reason, headers) { this.status = status; this.headers = headers; return this; },
      end(buf) { this.writableEnded = true; clearTimeout(t); ok({ status: this.status, headers: this.headers, body: Buffer.from(buf ?? "").toString("utf8") }); },
    };
    const req = { method: "GET", url, headers: { host: "localhost" }, socket: { remoteAddress: "127.0.0.1" } };
    if (!pool.forward(req, res)) { clearTimeout(t); no(new Error("no worker was ready")); }
  });
}

/** Hand one MCP call to the pool as server.mjs's `handOver` does: POST /mcp, the body already read. */
function mcpRead(message, { mcp = true } = {}) {
  return new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error("the MCP read was never answered")), 180_000);
    const res = {
      writableEnded: false, destroyed: false, status: null, headers: null,
      writeHead(status, _reason, headers) { this.status = status; this.headers = headers; return this; },
      end(buf) { this.writableEnded = true; clearTimeout(t); ok({ status: this.status, headers: this.headers, body: Buffer.from(buf ?? "").toString("utf8") }); },
    };
    const req = { method: "POST", url: "/mcp", headers: { host: "localhost", authorization: `Bearer ${KEY}`, "content-type": "application/json" }, socket: { remoteAddress: "127.0.0.1" } };
    if (!pool.forward(req, res, { body: JSON.stringify({ jsonrpc: "2.0", id: 7, ...message }), mcp })) { clearTimeout(t); no(new Error("no worker was ready")); }
  });
}

const until = async (what, fn, ms = 90_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error(`timed out waiting for ${what}`);
};

before(async () => {
  if (!haveClone) return;
  Object.assign(process.env, FLAGS);
  tmp = mkdtempSync(join(tmpdir(), "postmark-read-workers-"));
  fixtureDb(join(tmp, "fixture.db")).close();
  // A read-role office refuses to boot without the writer's two stores (see
  // server.mjs § OAUTH_DB_PATH), so they are made here the way the writer makes them.
  const { openDynamic } = await import("../src/dynamic-store.mjs");
  openDynamic(join(tmp, "dynamic.db")).close();
  const { openOauthDb } = await import("../src/oauth.mjs");
  openOauthDb(join(tmp, "oauth.db")).close();
  pool = startReadPool({
    size: 2,
    entry: new URL("../src/server.mjs", import.meta.url),
    argv: ["--port", "0", "--db", join(tmp, "fixture.db"), "--oauth-db", join(tmp, "oauth.db"), "--roles-db", join(tmp, "roles.db")],
    env: { ...process.env, OFFICE_KEYS: `${KEY}=keemin:wright`, WORLD_DYNAMIC_DB: join(tmp, "dynamic.db"), TOWN_CLONE: join(ROOT, "town-clone") },
    log: { error: () => {} },
  });
  await until("both workers to be ready", () => pool.disclose().ready === 2);
});

after(async () => {
  if (pool) await pool.close();
  for (const [k, v] of Object.entries(was)) if (v == null) delete process.env[k]; else process.env[k] = v;
  if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("§ 1 a walk on the main thread is seen by the very next read on every worker", { skip: !haveClone && `needs the world clone at ${WORLD_CLONE}` }, async () => {
  const HANDLE = "read-worker-falsifier";
  const at = { x: 1234, y: -567 };
  const find = (r) => JSON.parse(r.body).walkers.find((w) => w.handle === HANDLE);

  // Both workers answer once first, so each has built its projection: a record
  // that reaches an unbuilt projection is left to its rebuild, which reads the
  // store, and this file has none — the announcement must be the only road.
  const warm = await Promise.all([read("/world/walkers"), read("/world/walkers")]);
  assert.deepEqual(warm.map((r) => r.headers["X-PM-Reader"]).sort(), ["worker-0", "worker-1"], "the two reads did not reach both workers");
  for (const r of warm) {
    assert.equal(r.status, 200);
    assert.equal(find(r), undefined, "the walker stands somewhere before she walked — the test proves nothing");
  }

  const { recordMoved } = await import("../src/world.mjs");
  const { worldToolModule } = await import("../src/dynamic-entities.mjs");
  const walk = await worldToolModule("walk.mjs", { repo: WORLD_CLONE });
  const now = Date.now();
  recordMoved({
    actor: HANDLE, from: at, toward: at, crossing: walk.fractionalCrossing(now), at: new Date(now).toISOString(),
    within: null, toMark: null, declaredBy: HANDLE, pace: null,
  });

  // IMMEDIATELY: no wait between the write and the reads.
  const after = await Promise.all([read("/world/walkers"), read("/world/walkers")]);
  assert.deepEqual(after.map((r) => r.headers["X-PM-Reader"]).sort(), ["worker-0", "worker-1"]);
  for (const r of after) {
    const w = find(r);
    assert.ok(w, `${r.headers["X-PM-Reader"]} answered without the walk the main thread just wrote`);
    assert.equal(w.x, at.x);
    assert.equal(w.y, at.y);
  }
});

test("§ 2 a killed worker's read is answered by another, the office keeps answering, and the slot is respawned", { skip: !haveClone && `needs the world clone at ${WORLD_CLONE}` }, async () => {
  const before = pool.threads();
  assert.ok(before.every((id) => id != null), "a worker was not up before the kill");

  // A read handed to worker 0 (both idle, so the first pick is slot 0), and
  // worker 0 killed before it can answer. /world/settlements, because it is
  // the slowest read the office has (a git child per settlement tag), so the
  // kill lands while it is still being read.
  const held = read("/world/settlements");
  const killed = pool.kill(0);
  const r = await held;
  await killed;
  assert.equal(r.status, 200, `the read the dead worker held was not answered (${r.status}: ${r.body.slice(0, 120)})`);
  assert.equal(r.headers["X-PM-Reader"], "worker-1");

  // While slot 0 is down, the office still answers.
  for (let i = 0; i < 3; i++) {
    const again = await read("/world/skeleton");
    assert.equal(again.status, 200);
  }

  // And slot 0 comes back as a new thread.
  await until("slot 0 to be respawned", () => pool.threads()[0] != null);
  const now = pool.threads();
  assert.notEqual(now[0], before[0], "slot 0 is the same thread — it was never killed");
  assert.equal(now[1], before[1]);
});

test("the dispatch rule: GETs go to workers except the main thread's RAM reads; writes, /mcp and the OAuth dance never do", () => {
  assert.equal(workerTakes("GET", "/world/walkers"), true);
  assert.equal(workerTakes("GET", "/world/conversations"), false);
  assert.equal(workerTakes("GET", "/world/dynamic"), false);
  assert.equal(workerTakes("GET", "/household"), false);
  // the house's posts (POS-293) ride the household door's path, so they stay home with it
  assert.equal(workerTakes("GET", "/household", new URLSearchParams("read=posts&handle=wright")), false);
  // the say stream waits on voices, which land on the main thread (merge seam, POS-265 × POS-266)
  assert.equal(workerTakes("GET", "/world/say/stream"), false);
  assert.equal(workerTakes("POST", "/world/walks"), false);
  assert.equal(workerTakes("GET", "/mcp"), false);
  assert.equal(workerTakes("GET", "/oauth/authorize"), false);
  // the REST listen is the voices window by its query (POS-284's hotfix); the apex's other reads are not
  const q = (qs) => new URLSearchParams(qs);
  assert.equal(workerTakes("GET", "/world/apex", q("read=say")), false, "the REST listen");
  assert.equal(workerTakes("GET", "/world/apex", q("read=%20say%20")), false, "trimmed as the apex trims it");
  assert.equal(workerTakes("GET", "/world/apex", q("read=say&since=1")), false);
  assert.equal(workerTakes("GET", "/world/apex", q("")), true, "the bare look");
  assert.equal(workerTakes("GET", "/world/apex", q("read=walk")), true, "a shadow");
  assert.equal(workerTakes("GET", "/world/apex"), true, "no query at all");
  assert.equal(workerTakes("GET", "/world/walkers", q("read=say")), true, "the query names the listen only on the apex");
});

test("the MCP dispatch rule: orient, open-your-eyes and the apex's reads go to workers; acts and the listen never do (POS-284)", () => {
  const call = (name, args) => [{ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }];
  assert.equal(mcpWorkerTakes(call("world_orient", {})), true);
  assert.equal(mcpWorkerTakes(call("world_open_your_eyes", { handle: "wright" })), true);
  assert.equal(mcpWorkerTakes(call("world", {})), true, "the bare look");
  assert.equal(mcpWorkerTakes(call("world", { read: "walk" })), true, "a shadow");
  assert.equal(mcpWorkerTakes(call("world", { do: "say", args: { text: "hi" } })), false, "an act");
  assert.equal(mcpWorkerTakes(call("world", { read: "say" })), false, "a listen marks the listener present, in the main thread's RAM");
  assert.equal(mcpWorkerTakes(call("world", { read: " say " })), false);
  assert.equal(mcpWorkerTakes(call("household", {})), false, "the standing read carries the bouncer's budget");
  assert.equal(mcpWorkerTakes(call("world_say", { text: "hi" })), false);
  assert.equal(mcpWorkerTakes([{ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }]), false);
  assert.equal(mcpWorkerTakes([{ jsonrpc: "2.0", method: "tools/call", params: { name: "world_orient" } }]), false, "a notification has no answer to hand back");
  assert.equal(mcpWorkerTakes([...call("world_orient", {}), ...call("world", { do: "say" })]), false, "a batch goes only if every call in it does");
  assert.equal(mcpWorkerTakes([]), false);
});

test("§ 3 an agent's MCP read is answered by a worker, and anything else handed to one is refused", { skip: !haveClone && `needs the world clone at ${WORLD_CLONE}` }, async () => {
  for (const name of ["world_orient", "world_open_your_eyes"]) {
    const r = await mcpRead({ method: "tools/call", params: { name, arguments: {} } });
    assert.equal(r.status, 200, `${name}: ${r.body.slice(0, 200)}`);
    assert.match(r.headers["X-PM-Reader"], /^worker-\d$/);
    const rpc = JSON.parse(r.body);
    assert.equal(rpc.id, 7);
    const text = rpc.result?.content?.[0]?.text;
    assert.ok(text, `${name} answered no content: ${r.body.slice(0, 200)}`);
    const answer = JSON.parse(text);
    // orient names where you stand; open-your-eyes names what you see.
    assert.ok(name === "world_orient" ? answer.standpoint : Array.isArray(answer.objects),
      `${name} answered in another read's shape, or a bounce: ${text.slice(0, 200)}`);
  }
  // An act, handed over anyway: the worker's MCP door refuses it by name.
  const act = await mcpRead({ method: "tools/call", params: { name: "world", arguments: { do: "say", args: { text: "from a worker" } } } });
  assert.equal(act.status, 405);
  assert.match(act.body, /answers the agents' reads only/);
  // And POST /mcp without the hand-over's flag is the read role's own refusal.
  const bare = await mcpRead({ method: "tools/call", params: { name: "world_orient", arguments: {} } }, { mcp: false });
  assert.equal(bare.status, 405);
  assert.match(bare.body, /this office reads only/);
});

test("§ 4 a real office hands the agents' reads to its worker and keeps the acts", { skip: !haveClone && `needs the world clone at ${WORLD_CLONE}` }, async () => {
  const port = 47000 + ((process.pid * 11) % 1500);
  const proc = spawn(process.execPath, [
    join(ROOT, "src", "server.mjs"), "--port", String(port),
    "--db", join(tmp, "fixture.db"), "--oauth-db", join(tmp, "oauth.db"), "--roles-db", join(tmp, "roles.db"),
  ], {
    env: { ...process.env, OFFICE_READ_WORKERS: "1", OFFICE_KEYS: `${KEY}=keemin:wright`,
      WORLD_DYNAMIC_DB: join(tmp, "dynamic.db"), TOWN_CLONE: join(ROOT, "town-clone") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const gone = new Promise((ok) => proc.on("exit", ok));
  try {
    let out = "";
    await new Promise((ok, no) => {
      const t = setTimeout(() => no(new Error(`the office never listened: ${out}`)), 30_000);
      proc.stdout.on("data", (d) => { out += String(d); if (out.includes("listening")) { clearTimeout(t); ok(); } });
    });
    const base = `http://127.0.0.1:${port}`;
    let ready = 0;
    for (let i = 0; i < 300 && ready !== 1; i++) {
      ready = (await (await fetch(`${base}/release`)).json()).read_workers?.ready ?? 0;
      if (ready !== 1) await new Promise((r) => setTimeout(r, 200));
    }
    assert.equal(ready, 1, "the office's worker never came up");
    const post = (name, args) => fetch(`${base}/mcp`, { method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
    const orient = await post("world_orient", {});
    const orientBody = await orient.text();
    assert.equal(orient.status, 200, orientBody.slice(0, 200));
    assert.equal(orient.headers.get("x-pm-reader"), "worker-0", "world_orient was answered on the main thread");
    const say = await post("world", { do: "say", args: { text: "an act stays home" } });
    await say.text();
    assert.equal(say.headers.get("x-pm-reader"), null, "an act was handed to a worker");
    const listen = await post("world", { read: "say" });
    await listen.text();
    assert.equal(listen.headers.get("x-pm-reader"), null, "a listen was handed to a worker");
    // THE HOUSE'S POSTS (POS-293) are answered where /household is: the main
    // thread, beside the same office's worker that just answered world_orient.
    const posts = await fetch(`${base}/household?read=posts&handle=wright`);
    const postsBody = await posts.text();
    assert.equal(posts.status, 200, postsBody.slice(0, 200));
    assert.ok(JSON.parse(postsBody).put_up, `GET /household?read=posts answered another read: ${postsBody.slice(0, 200)}`);
    assert.equal(posts.headers.get("x-pm-reader"), null, "the house's posts were handed to a worker");
  } finally {
    proc.kill();
    await gone;
  }
});

test("§ 5 the REST listen is answered by the main thread and hears the say before it; the bare apex read still goes to the worker (POS-284's hotfix)", { skip: !haveClone && `needs the world clone at ${WORLD_CLONE}` }, async () => {
  // The listen's card is the class layer's answer, so this office has a world store.
  const worldDb = join(tmp, "world.db");
  execFileSync(process.execPath, [join(ROOT, "src", "world-hydrate.mjs"), "--world", WORLD_CLONE, "--no-db", "--rows-out", `${worldDb}.rows.json`, "--no-gexf", "--no-lints"], { stdio: "ignore" });
  const port = 48500 + ((process.pid * 13) % 1000);
  const proc = spawn(process.execPath, [
    join(ROOT, "src", "server.mjs"), "--port", String(port),
    "--db", join(tmp, "fixture.db"), "--oauth-db", join(tmp, "oauth.db"), "--roles-db", join(tmp, "roles.db"),
  ], {
    env: { ...process.env, OFFICE_READ_WORKERS: "1", WORLD_APEX: "1", OFFICE_KEYS: `${KEY}=keemin:wright`,
      WORLD_GRAPH_ROWS: `${worldDb}.rows.json`, WORLD_STORE_DB: join(tmp, "no-world-db-here.db"),   // the world is the rows (POS-270 lane W 3a)
      VOICES_LOG: join(tmp, "voices-5.jsonl"),
      WORLD_DYNAMIC_DB: join(tmp, "dynamic.db"), TOWN_CLONE: join(ROOT, "town-clone") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const gone = new Promise((ok) => proc.on("exit", ok));
  try {
    let out = "";
    await new Promise((ok, no) => {
      const t = setTimeout(() => no(new Error(`the office never listened: ${out}`)), 30_000);
      proc.stdout.on("data", (d) => { out += String(d); if (out.includes("listening")) { clearTimeout(t); ok(); } });
    });
    const base = `http://127.0.0.1:${port}`;
    let ready = 0;
    for (let i = 0; i < 300 && ready !== 1; i++) {
      ready = (await (await fetch(`${base}/release`)).json()).read_workers?.ready ?? 0;
      if (ready !== 1) await new Promise((r) => setTimeout(r, 200));
    }
    assert.equal(ready, 1, "the office's worker never came up");
    const auth = { authorization: `Bearer ${KEY}` };
    const get = (qs) => fetch(`${base}/world/apex${qs}`, { headers: auth });
    // A listen first, so a worker that answered it would hold a window hydrated before the say.
    await (await get("?read=say")).text();
    const words = `the listen hears this, said at ${Date.now()}`;
    const say = await fetch(`${base}/mcp`, { method: "POST",
      headers: { ...auth, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "world", arguments: { do: "say", args: { text: words } } } }) });
    const sayBody = await say.text();
    assert.equal(say.status, 200, sayBody.slice(0, 200));
    assert.ok(sayBody.includes('\\"did\\": \\"say\\"'), `the say did not land: ${sayBody.slice(0, 300)}`);
    const listen = await get("?read=say");
    const heard = await listen.text();
    assert.equal(listen.status, 200, heard.slice(0, 200));
    assert.equal(listen.headers.get("x-pm-reader"), null, "the REST listen was handed to a worker");
    assert.ok(heard.includes(words), "the REST listen did not hear the say before it");
    const look = await get("");
    await look.text();
    assert.equal(look.headers.get("x-pm-reader"), "worker-0", "the bare apex read stopped going to the worker");
  } finally {
    proc.kill();
    await gone;
  }
});

test("§ 6 a `before:` page is answered by the main thread; at the door a voice from before the settlement is never heard (POS-226)", { skip: !haveClone && `needs the world clone at ${WORLD_CLONE}` }, async () => {
  const settledAt = await publishedSettlementAt(WORLD_CLONE);
  assert.ok(Number.isFinite(settledAt), "the pinned world clone carries a published settlement");
  const worldDb = join(tmp, "world-6.db");
  execFileSync(process.execPath, [join(ROOT, "src", "world-hydrate.mjs"), "--world", WORLD_CLONE, "--no-db", "--rows-out", `${worldDb}.rows.json`, "--no-gexf", "--no-lints"], { stdio: "ignore" });
  const voicesLog = join(tmp, "voices-6.jsonl");
  const port = 49600 + ((process.pid * 7) % 300);
  const proc = spawn(process.execPath, [
    join(ROOT, "src", "server.mjs"), "--port", String(port),
    "--db", join(tmp, "fixture.db"), "--oauth-db", join(tmp, "oauth.db"), "--roles-db", join(tmp, "roles.db"),
  ], {
    env: { ...process.env, OFFICE_READ_WORKERS: "1", WORLD_APEX: "1", OFFICE_KEYS: `${KEY}=keemin:wright`,
      WORLD_GRAPH_ROWS: `${worldDb}.rows.json`, WORLD_STORE_DB: join(tmp, "no-world-db-here.db"),   // the world is the rows (POS-270 lane W 3a)
      VOICES_LOG: voicesLog,
      WORLD_DYNAMIC_DB: join(tmp, "dynamic.db"), TOWN_CLONE: join(ROOT, "town-clone") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const gone = new Promise((ok) => proc.on("exit", ok));
  try {
    let out = "";
    await new Promise((ok, no) => {
      const t = setTimeout(() => no(new Error(`the office never listened: ${out}`)), 30_000);
      proc.stdout.on("data", (d) => { out += String(d); if (out.includes("listening")) { clearTimeout(t); ok(); } });
    });
    const base = `http://127.0.0.1:${port}`;
    let ready = 0;
    for (let i = 0; i < 300 && ready !== 1; i++) {
      ready = (await (await fetch(`${base}/release`)).json()).read_workers?.ready ?? 0;
      if (ready !== 1) await new Promise((r) => setTimeout(r, 200));
    }
    assert.equal(ready, 1, "the office's worker never came up");
    const auth = { authorization: `Bearer ${KEY}` };
    // Where wright stands, from the spectator-free orient — before any voice is
    // asked for, so the office has not yet read the log this test is about to write.
    const orient = await fetch(`${base}/mcp`, { method: "POST",
      headers: { ...auth, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "world_orient", arguments: {} } }) });
    const ob = await orient.text();
    const sp = JSON.parse(JSON.parse(ob.slice(ob.indexOf("{"))).result.content[0].text).standpoint;
    assert.ok(Number.isFinite(sp?.x) && Number.isFinite(sp?.y), `no standpoint in orient: ${ob.slice(0, 300)}`);
    const line = (at, text) => JSON.stringify({ at: new Date(at).toISOString(), handle: "rei", text, x: sp.x, y: sp.y, place: null, aboard: false });
    const lines = [line(settledAt - 60_000, "said before the settlement")];
    for (let i = 1; i <= 25; i++) lines.push(line(settledAt + i * 16_000, `since ${String(i).padStart(2, "0")}`));
    writeFileSync(voicesLog, `${lines.join("\n")}\n`);

    const get = (qs) => fetch(`${base}/world/apex${qs}`, { headers: auth });
    const body = async (res) => { const t = await res.text(); assert.equal(res.status, 200, t.slice(0, 300)); return JSON.parse(t); };
    const first = await get("?read=say");
    assert.equal(first.headers.get("x-pm-reader"), null, "the listen was handed to a worker");
    const room = await body(first);
    const heard = room.heard ?? room;
    assert.equal(heard.voices.length, 20, "the default reply is the newest twenty");
    assert.equal(heard.hearable_since, new Date(settledAt).toISOString(), "the window opens at the clone's newest publish");
    assert.ok(Number.isFinite(heard.older), "the cursor back rides");

    const back = await get(`?read=say&args=${encodeURIComponent(JSON.stringify({ before: heard.older }))}`);
    assert.equal(back.headers.get("x-pm-reader"), null, "a `before:` page was handed to a worker");
    const page = (await body(back)).heard;
    assert.deepEqual(page.voices.map((v) => v.said), ["since 01", "since 02", "since 03", "since 04", "since 05"],
      "the page back stops at the settlement: the older voice is not heard");
    assert.equal(page.older, null);
  } finally {
    proc.kill();
    await gone;
  }
});

// ── § 7 A LETTER OPENED IN FULL IS A WRITE (POS-286, ruling (a)) ────────────
//
// A full letter read clears unread for the recipients the caller's key holds,
// and a read-role worker does not write. So a KEYED GET /letters/{id} or
// GET /town/apex?read=letter is answered here on the main thread, and a keyless
// one (which writes nothing) still goes to the worker. The answer's bytes are
// the same on both threads. Whether the clear lands is proved with a store in
// test/unread.test.mjs (§ 7, through the stub) and against a real Postgres in
// the lane's paperwork; this office has no store, so it proves the ROUTING.
test("§ 7 a keyed full letter read stays on the main thread; a keyless one goes to the worker, and the bytes agree", async () => {
  // Clear of § 6's 49600–49899 (POS-226), which this range overlapped until the rebase.
  const port = 50500 + ((process.pid * 17) % 400);
  const KEY2 = "read-workers-test-key-limen";
  const env = { ...process.env, OFFICE_READ_WORKERS: "1", WORLD_APEX: "1",
    OFFICE_KEYS: `${KEY}=keemin:wright;${KEY2}=limen-house:limen`,
    WORLD_DYNAMIC_DB: join(tmp, "dynamic.db"), TOWN_CLONE: join(ROOT, "town-clone") };
  delete env.WORLD2_PG; delete env.WORLD2_PG_URL;
  const proc = spawn(process.execPath, [
    join(ROOT, "src", "server.mjs"), "--port", String(port),
    "--db", join(tmp, "fixture.db"), "--oauth-db", join(tmp, "oauth.db"), "--roles-db", join(tmp, "roles.db"),
  ], { env, stdio: ["ignore", "pipe", "pipe"] });
  const gone = new Promise((ok) => proc.on("exit", ok));
  try {
    let out = "";
    await new Promise((ok, no) => {
      const t = setTimeout(() => no(new Error(`the office never listened: ${out}`)), 30_000);
      proc.stdout.on("data", (d) => { out += String(d); if (out.includes("listening")) { clearTimeout(t); ok(); } });
    });
    const base = `http://127.0.0.1:${port}`;
    let ready = 0;
    for (let i = 0; i < 300 && ready !== 1; i++) {
      ready = (await (await fetch(`${base}/release`)).json()).read_workers?.ready ?? 0;
      if (ready !== 1) await new Promise((r) => setTimeout(r, 200));
    }
    assert.equal(ready, 1, "the office's worker never came up");
    const id = "limen-2026-07-01-to-wright-the-gap";   // limen → wright
    const get = async (p, bearer) => {
      const r = await fetch(`${base}${p}`, { headers: bearer ? { authorization: `Bearer ${bearer}` } : {} });
      return { status: r.status, reader: r.headers.get("x-pm-reader"), body: await r.text() };
    };
    const letterPath = `/letters/${encodeURIComponent(id)}`;
    const keyless = await get(letterPath);
    assert.equal(keyless.status, 200, keyless.body.slice(0, 200));
    assert.equal(keyless.reader, "worker-0", "a keyless letter read writes nothing and should be the worker's");
    for (const [who, bearer] of [["the recipient", KEY], ["the sender", KEY2]]) {
      const r = await get(letterPath, bearer);
      assert.equal(r.status, 200, r.body.slice(0, 200));
      assert.equal(r.reader, null, `${who}'s keyed letter read was handed to a worker, which cannot write the opening`);
      assert.equal(r.body, keyless.body, `${who}'s answer is not the letter's bytes`);
    }
    const apexPath = `/town/apex?read=letter&args=${encodeURIComponent(JSON.stringify({ id }))}`;
    const apexKeyed = await get(apexPath, KEY);
    assert.equal(apexKeyed.status, 200, apexKeyed.body.slice(0, 200));
    assert.equal(apexKeyed.reader, null, "the keyed town letter read was handed to a worker");
    const apexKeyless = await get(apexPath);
    assert.equal(apexKeyless.reader, "worker-0");
    assert.equal(apexKeyed.body, apexKeyless.body);
  } finally {
    proc.kill();
    await gone;
  }
});
