// read-workers.mjs — reads answered on the other cores, writes kept on one
// thread (POS-266, "the office holds a crowd").
//
// ── THE SHAPE ────────────────────────────────────────────────────────────────
//
// The box has four cores and the office used one. On the Snug Harbour night a
// single read (/world/settlements, /world/present) held the one thread for
// seconds, and every caller behind it waited, the letters included. So:
//
//   - THE MAIN THREAD keeps the port, every write, the admission (the bouncer's
//     buckets are its RAM), the telemetry line, and every read whose answer
//     lives in its own memory (MAIN_ONLY_READS below).
//   - N READ WORKERS (worker_threads, N = cores − 1, OFFICE_READ_WORKERS to
//     tune, 0 to switch off) each run the SAME server module as a read-role
//     office (`role.mjs`: sqlite read-only, no pen, the unsafe doors refused by
//     name) that never listens. The main thread hands a worker a read after it
//     has admitted it, and writes the worker's answer back on its own socket.
//
// Each worker holds its own caches: it is a fresh module graph. Most of them
// are keyed on a stamp the worker reads itself (a file's mtime, a ref file, a
// table's count), and those need nothing from here. The ones a WRITE on the
// main thread moves in memory are told by a message — `announce(kind, payload)`
// on the main thread, `onAnnounce(kind, fn)` in the module that owns the cache.
// Messages and requests to one worker ride ONE port, and a port delivers in
// order, so a read handed over after a write's announcement is answered after
// the worker has applied it. That is the whole freshness guarantee: no read on a
// worker is older than the write that preceded it by more than that one hop.
// The inventory of every cache and how its worker learns it moved is in
// docs/read-workers.md.
//
// ── WHY THREADS AND NOT DEC-4's PROCESSES ────────────────────────────────────
//
// DEC-4 (2026-09-08) proposed three read PROCESSES behind nginx, and its kit
// (deploy/postmark-office-read@.service, nginx-postmark-read-pool*.conf) was
// never applied. A process cannot be told what moved: since POS-264 the
// positions projection is RAM on the writer, fed by its walk door, and a read
// process would answer walkers from a projection up to PROJECTION_MAX_AGE_MS
// old. The worker keeps DEC-4's three refusals (it boots as `--role read`), and
// replaces its transport.

import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { availableParallelism } from "node:os";
import { Writable } from "node:stream";
import { workerSafe } from "./role.mjs";

/** True inside a read worker. Everything that must not run twice keys on this. */
export const IN_READ_WORKER = !isMainThread && workerData?.readWorker === true;

/**
 * The reads a worker must NOT answer, because the answer is the main thread's
 * RAM and no message keeps a copy of it:
 *
 *   /world/conversations — the voices window (voices.mjs), appended by every say
 *                          on the main thread; a worker's copy hydrates the log
 *                          once and would never see another voice. voices.mjs is
 *                          O1's, so the window is not taught to listen here.
 *   /world/dynamic       — `acts_by_channel` (channel.mjs), counted per act on
 *                          the main thread.
 *   /household           — the standing read carries `world_writes`, the
 *                          bouncer's live budget, which is main-thread RAM.
 *
 * A read not named here, not refused by `workerSafe` and not the REST listen
 * (`listensToVoices` below) goes to a worker.
 */
// /world/say/stream (POS-265's push) waits on new voices, and voices land on the
// main thread: served from a worker, the stream would open and never hear a word.
export const MAIN_ONLY_READS = new Set(["/world/conversations", "/world/dynamic", "/household", "/world/say/stream"]);

/**
 * GET /world/apex?read=say is the one read whose answer is the voices window by
 * its QUERY, not its path: the same listen as the MCP `world { read: "say" }`,
 * which `mcpWorkerTakes` below keeps home. Handed to a worker, it heard the
 * worker's window as it hydrated and never another voice (POS-284's hotfix,
 * measured before the fix: a say on the main thread, then this GET on worker-0,
 * and the voice was not in it). `read` is trimmed as the apex trims it.
 */
function listensToVoices(path, query) {
  return path === "/world/apex" && String(query?.get("read") ?? "").trim() === "say";
}

/** Does a read with this method, path and query go to a worker? */
export function workerTakes(method, path, query = null) {
  return method === "GET" && workerSafe(method, path) && !MAIN_ONLY_READS.has(path) && !listensToVoices(path, query);
}

/**
 * THE AGENTS' READS (POS-284). An agent reads through POST /mcp, so the method
 * rule above sends every one of them to the main thread, where on dev at 80
 * agents open-your-eyes alone held a third of the thread. These MCP calls are
 * the same reads the workers already answer as GETs (/world/orient,
 * /world/eyes, /world/apex), through the same functions:
 *
 *   world_orient, world_open_your_eyes, and `world` with no `do:`: the bare
 *   look and every `read:` shadow, save `read: "say"`, which listens, and a
 *   listen is the voices window's RAM (it marks the listener present).
 *
 * A NAMED LIST, not "everything that is not a write": `writeShaped` answers
 * which calls the bouncer charges as acts, not which answers live in the main
 * thread's memory (the household standing read's `world_writes` is a read and
 * is the bouncer's own RAM). A read not named here stays on the main thread.
 * The main thread admits and charges the call first, exactly as for a GET;
 * the worker answers it and refuses anything this list does not name.
 */
const MCP_WORKER_TOOLS = new Set(["world_orient", "world_open_your_eyes"]);
export function mcpWorkerTakes(messages) {
  if (!Array.isArray(messages) || !messages.length) return false;
  return messages.every((m) => {
    if (m?.jsonrpc !== "2.0" || m.method !== "tools/call" || m.id === undefined) return false;
    const name = m.params?.name;
    const args = m.params?.arguments ?? {};
    if (MCP_WORKER_TOOLS.has(name)) return true;
    if (name !== "world" || typeof args !== "object" || Array.isArray(args)) return false;
    if (args.do != null && args.do !== "") return false;
    return String(args.read ?? "").trim() !== "say";
  });
}

/** How many workers: OFFICE_READ_WORKERS if it is a whole number, else cores − 1. */
export function readWorkerCount(env = process.env, cores = availableParallelism()) {
  const raw = env.OFFICE_READ_WORKERS;
  if (raw != null && String(raw).trim() !== "") {
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 0) return n;
    console.warn(`WARN: OFFICE_READ_WORKERS="${raw}" is not a whole number; using cores − 1`);
  }
  return Math.max(0, cores - 1);
}

// ── ANNOUNCEMENTS: what a write moved ───────────────────────────────────────

const listeners = new Map(); // kind -> [fn]
let broadcast = null;        // set on the main thread by a running pool

/** Main thread: tell every worker that `kind` moved. A no-op without a pool, and in a worker. */
export function announce(kind, payload = null) {
  if (broadcast) broadcast(kind, payload);
}

/** In a worker: run `fn(payload)` when the main thread announces `kind`. Inert on the main thread. */
export function onAnnounce(kind, fn) {
  if (!IN_READ_WORKER) return;
  if (!listeners.has(kind)) listeners.set(kind, []);
  listeners.get(kind).push(fn);
}

// ── THE WORKER'S SIDE ────────────────────────────────────────────────────────

/** A response a handler can write to as if it were http.ServerResponse, collected for the port. */
class CollectedResponse extends Writable {
  constructor(onDone) {
    super();
    this.statusCode = 200;
    this.statusMessage = "";
    this.headersSent = false;
    this._headers = new Map(); // lower-case name -> [name, value]
    this._chunks = [];
    this._onDone = onDone;
    this.on("finish", () => {
      this._onDone(this);
      this.emit("close");
    });
  }
  setHeader(name, value) { this._headers.set(String(name).toLowerCase(), [name, value]); return this; }
  getHeader(name) { return this._headers.get(String(name).toLowerCase())?.[1]; }
  getHeaders() { return Object.fromEntries([...this._headers.values()].map(([k, v]) => [k.toLowerCase(), v])); }
  hasHeader(name) { return this._headers.has(String(name).toLowerCase()); }
  removeHeader(name) { this._headers.delete(String(name).toLowerCase()); }
  writeHead(code, reason, headers) {
    if (typeof reason === "object" && reason !== null) { headers = reason; reason = undefined; }
    this.statusCode = code;
    if (typeof reason === "string") this.statusMessage = reason;
    if (Array.isArray(headers)) for (let i = 0; i + 1 < headers.length; i += 2) this.setHeader(headers[i], headers[i + 1]);
    else if (headers) for (const [k, v] of Object.entries(headers)) this.setHeader(k, v);
    this.headersSent = true;
    return this;
  }
  flushHeaders() { this.headersSent = true; }
  _write(chunk, encoding, cb) {
    this.headersSent = true;
    this._chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
    cb();
  }
  body() { return Buffer.concat(this._chunks); }
  headerPairs() { return [...this._headers.values()]; }
}

/** Serve the reads the main thread hands over, through `handle(req, res)`. */
export function serveReadsInWorker(handle) {
  parentPort.on("message", (msg) => {
    if (msg?.type === "announce") {
      for (const fn of listeners.get(msg.kind) ?? []) {
        try { fn(msg.payload); }
        catch (e) { console.error(`[read-worker] the ${msg.kind} listener threw (${String(e?.message ?? e).slice(0, 120)})`); }
      }
      return;
    }
    if (msg?.type !== "read") return;
    const { id, method, url, headers, ip, body = null, mcp = false } = msg;
    // An ended request: a GET's is empty, an agent's MCP read (POS-284) carries
    // the JSON-RPC body the main thread already read, delivered as one chunk
    // before the end.
    const req = new Writable({ write(_c, _e, cb) { cb(); } });
    Object.assign(req, { method, url, headers, socket: { remoteAddress: ip }, connection: { remoteAddress: ip }, handedMcpRead: Boolean(mcp) });
    req.on = ((on) => function (ev, fn) {
      if (ev === "end") { queueMicrotask(() => queueMicrotask(fn)); return this; }
      if (ev === "data") { if (body != null) queueMicrotask(() => fn(body)); return this; }
      return on.call(this, ev, fn);
    })(req.on);
    const res = new CollectedResponse((r) => {
      const body = r.body();
      const ab = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
      parentPort.postMessage({ type: "answer", id, status: r.statusCode, statusMessage: r.statusMessage, headers: r.headerPairs(), body: ab }, [ab]);
    });
    try { handle(req, res); }
    catch (e) {
      parentPort.postMessage({ type: "answer", id, status: 500, headers: [["Content-Type", "application/json"]],
        body: Buffer.from(JSON.stringify({ error: "the read worker tripped", hint: String(e?.message ?? e).slice(0, 200) })).buffer });
    }
  });
  parentPort.postMessage({ type: "ready" });
}

// ── THE MAIN THREAD'S SIDE ───────────────────────────────────────────────────

/**
 * Start `size` workers running `entry` (the server module) as read-role
 * offices. A worker that exits is respawned; a worker that exits BEFORE it was
 * ever ready is a boot refusal (read role's EX_CONFIG guards: no oauth.db, no
 * dynamic.db), and after three of those in a row the pool stops trying and the
 * main thread keeps every read, loudly. The reads a dead worker was holding are
 * handed to another worker once (a GET is safe to ask again), else answered 503.
 */
export function startReadPool({ size, entry, argv = [], env = process.env, respawnMs = 250, log = console } = {}) {
  const workers = []; // { w, ready, inflight: Map<id, pending>, n }
  const pending = new Map(); // id -> { res, head, tries, slot }
  let nextId = 1;
  let bootFailures = 0;
  let stopped = false;

  const argvFor = () => {
    const out = [];
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === "--role") { i++; continue; }
      out.push(argv[i]);
    }
    return [...out, "--role", "read"];
  };

  function spawn(slot) {
    const w = new Worker(entry, {
      argv: argvFor(),
      env: { ...env, OFFICE_ROLE: "read" },
      workerData: { readWorker: true, slot },
    });
    const rec = { w, ready: false, inflight: new Set(), slot, served: 0 };
    workers[slot] = rec;
    w.on("message", (msg) => {
      if (msg?.type === "ready") { rec.ready = true; bootFailures = 0; return; }
      if (msg?.type !== "answer") return;
      const p = pending.get(msg.id);
      rec.inflight.delete(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      rec.served++;
      write(p.res, msg, slot);
    });
    w.on("error", (e) => log.error(`[read-workers] worker ${slot} threw: ${String(e?.message ?? e).slice(0, 200)}`));
    w.on("exit", (code) => {
      const wasReady = rec.ready;
      rec.ready = false;
      if (workers[slot] === rec) workers[slot] = null;
      // What it was holding goes to another worker once, or is refused plainly.
      for (const id of rec.inflight) {
        const p = pending.get(id);
        if (!p) continue;
        pending.delete(id);
        if (p.tries < 1 && dispatch(p.res, p.msg, p.tries + 1)) continue;
        refuse(p.res);
      }
      rec.inflight.clear();
      if (stopped) return;
      if (!wasReady) bootFailures++;
      if (bootFailures >= 3) {
        log.error(`[read-workers] worker ${slot} exited (${code}) before it was ready, three times running — the pool is stopped and the main thread answers every read`);
        stopped = true;
        broadcast = null;
        return;
      }
      log.error(`[read-workers] worker ${slot} exited (${code}); respawning`);
      setTimeout(() => { if (!stopped) spawn(slot); }, respawnMs).unref();
    });
  }

  function write(res, msg, slot) {
    if (res.writableEnded || res.destroyed) return;
    const headers = {};
    for (const [k, v] of msg.headers ?? []) headers[k] = v;
    // Which thread answered, the way DEC-4's X-PM-Upstream named the process.
    headers["X-PM-Reader"] = `worker-${slot}`;
    res.writeHead(msg.status, msg.statusMessage || undefined, headers);
    res.end(Buffer.from(msg.body ?? new ArrayBuffer(0)));
  }

  function refuse(res) {
    if (res.writableEnded || res.destroyed) return;
    res.writeHead(503, { "Content-Type": "application/json", "Retry-After": "1" });
    res.end(JSON.stringify({ error: "the reader stopped", code: 503,
      defect: "the read worker holding this request stopped before it answered",
      hint: "ask again; a read is safe to repeat and another worker will take it" }));
  }

  function pick() {
    let best = null;
    for (const r of workers) if (r?.ready && (!best || r.inflight.size < best.inflight.size)) best = r;
    return best;
  }

  function dispatch(res, msg, tries = 0) {
    const r = pick();
    if (!r) return false;
    const id = nextId++;
    const m = { ...msg, id };
    pending.set(id, { res, msg, tries });
    r.inflight.add(id);
    r.w.postMessage(m);
    return true;
  }

  broadcast = (kind, payload) => {
    for (const r of workers) if (r) r.w.postMessage({ type: "announce", kind, payload });
  };

  for (let i = 0; i < size; i++) spawn(i);

  return {
    size,
    /**
     * Hand a read to a worker. False when none is ready: the caller answers it
     * itself. `body` and `mcp` are an agent's MCP read (POS-284): the body the
     * main thread already read, and the flag that lets the worker's POST /mcp
     * past the read role's refusal for this call alone.
     */
    forward(req, res, { body = null, mcp = false } = {}) {
      if (stopped) return false;
      return dispatch(res, {
        type: "read",
        method: req.method,
        url: req.url,
        headers: req.headers,
        ip: req.socket?.remoteAddress ?? null,
        ...(mcp ? { body, mcp: true } : {}),
      });
    },
    /** What the pool is, for /release: how many workers are up and what each has served. */
    disclose() {
      return {
        size,
        stopped,
        ready: workers.filter((r) => r?.ready).length,
        served: workers.map((r) => r?.served ?? 0),
        in_flight: workers.map((r) => r?.inflight.size ?? 0),
      };
    },
    /** The workers' thread ids, for the kill falsifier. */
    threads() { return workers.map((r) => (r?.ready ? r.w.threadId : null)); },
    kill(slot) { return workers[slot]?.w.terminate(); },
    async close() {
      stopped = true;
      broadcast = null;
      await Promise.all(workers.map((r) => r?.w.terminate()));
    },
  };
}
