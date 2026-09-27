#!/usr/bin/env node
// party-replay.mjs — the Snug Harbour night's shape, replayed against the DEV
// office, so a crowd can be seen before anyone optimises for one (POS-267).
//
//   ssh -N -L 14381:127.0.0.1:4381 meepo-ec2        # the dev office's own port
//   node tools/party-replay.mjs --base http://127.0.0.1:14381 --steps 5:0,10:0,20:0,40:0
//
// ── THE SHAPE ────────────────────────────────────────────────────────────────
//
// AGENTS stand in one room and speak: each calls `world { do: "say" }` through
// MCP every 60-90 s (uniform), the first say at a random point in the first 90 s
// so a step does not open with a thundering herd. VIEWERS hold the World page
// open: on arrival they fetch what the page fetches to draw, then every 15 s
// they poll the four live reads. Both lists are the office's own access
// telemetry for the night (2026-09-26 22:00-01:00Z), not a guess:
// /world/present, /world/settlements, /world/conversations, /world/walkers,
// /world/state, /world/enter-exit-ledger, /world/skeleton and /world2/walks were
// the keyless world reads, in that order of volume.
//
// A PROBE asks GET /release every 5 s. It is the cheapest door the office has
// (a constant in memory), so its latency is almost entirely time spent waiting
// for the thread: that is the BACKLOG, measured from outside. The client's own
// count of open requests rides beside it. When the office serves GET
// /ops/loop-lag (src/loop-lag.mjs) the last minute of it is printed too.
//
// ── WHO THE AGENTS ARE, SAID PLAINLY ─────────────────────────────────────────
//
// Berths. POST /berth mints a keyless ephemeral identity through the office's
// existing door (read everything, speak from the quay, seven-day sunset), so
// every agent here is `berth-replay-<run>-<n>` standing on the quay, and the
// quay is the one room. What that does NOT reproduce: a resident's say derives
// the speaker's standpoint through world movement (a berth's is the quay's
// fixed point), so the per-speaker movement read of the real night is absent.
// Residents would need N household keys on dev, which only a GitHub sign-in or
// a write into dev's oauth.db can mint. Every run's report repeats this.
//
// Each simulated client sends its own X-Forwarded-For (10.77.x.y). The office
// takes the LAST hop of that header as the client (server.mjs § clientIp), which
// behind nginx is the real address; talking to the office's port directly, it is
// the only way N simulated clients are N clients to the keyless bucket and the
// berth mint cap rather than one address that runs dry in a second. So point
// --base at the office's port, never at an nginx vhost.
//
// ── WHAT IT REFUSES ──────────────────────────────────────────────────────────
//
// Anything but the dev office. The office's own deploy receipt decides:
// GET /release must answer `target: "dev"` (release.json, written by the deploy
// or the hand-carry), and a base whose host is postmark.town or the atelier
// alias is refused before any request is made. A /release that does not answer
// in 20 s is also a refusal, because an office too busy to say what it is is
// not one to add a crowd to.
//
// ── OUTPUT ───────────────────────────────────────────────────────────────────
//
// Per step: throughput (responses per second), p50/p95/max per route, errors and
// client timeouts, the probe's p50/p95/max (the backlog) and the most requests
// the client held open at once. COLLAPSE is the probe's p50 at or past
// --collapse-s (default 10 s): past that the thread is the queue. With
// --stop-on-collapse (default) the ramp stops at the first collapsed step, and
// the verdict names the agents and viewers at which it started. --out writes the
// whole run as JSON.
//
// It writes into DEV: N berths (they sunset in seven days) and their voices.

import { writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(name);
const num = (name, fallback) => {
  const v = Number(arg(name, fallback));
  if (!Number.isFinite(v) || v < 0) { console.error(`party-replay: ${name} must be a number ≥ 0`); process.exit(2); }
  return v;
};

if (flag("--help") || !arg("--base")) {
  console.log(`party-replay — the Snug night's shape against the DEV office
  node tools/party-replay.mjs --base <url> [--steps A:V,A:V,…] [--agents N --viewers M]
  --base <url>          the dev office's own port (e.g. an ssh tunnel to 127.0.0.1:4381)
  --steps A:V,…         a ramp: each step holds A agents and V viewers (never fewer than the step before)
  --agents N --viewers M   one step instead of a ramp
  --step-s 120          seconds per step
  --say-min 60 --say-max 90   an agent's seconds between says
  --poll-s 15           a viewer's seconds between polls
  --timeout-s 60        a client gives up after this (nginx's proxy_read_timeout for the world reads)
  --collapse-s 10       the probe p50 that calls a step collapsed
  --without /world/present,…   drop these reads from the viewers' lists
  --no-stop             keep ramping past a collapse
  --out <file.json>     the whole run, as JSON`);
  process.exit(flag("--help") ? 0 : 2);
}

const BASE = String(arg("--base")).replace(/\/+$/, "");
const STEP_S = num("--step-s", 120);
const SAY_MIN = num("--say-min", 60);
const SAY_MAX = Math.max(SAY_MIN, num("--say-max", 90));
const POLL_S = num("--poll-s", 15);
const TIMEOUT_MS = num("--timeout-s", 60) * 1000;
const COLLAPSE_MS = num("--collapse-s", 10) * 1000;
const STOP_ON_COLLAPSE = !flag("--no-stop");
const OUT = arg("--out");
const PROBE_MS = 5000;

const STEPS = (arg("--steps") ?? `${num("--agents", 0)}:${num("--viewers", 0)}`)
  .split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
    const [a, v = "0"] = s.split(":");
    return { agents: Number(a), viewers: Number(v) };
  });
if (STEPS.some((s) => !Number.isInteger(s.agents) || !Number.isInteger(s.viewers) || s.agents < 0 || s.viewers < 0)) {
  console.error("party-replay: --steps is agents:viewers, comma-separated, whole numbers"); process.exit(2);
}

// The World page's reads (see the header for where the lists came from).
const WITHOUT = new Set(String(arg("--without", "")).split(",").map((s) => s.trim()).filter(Boolean));
const PAGE_LOAD_ALL = ["/world/skeleton", "/world/settlements", "/world/enter-exit-ledger", "/world2/walks",
  "/world/conversations", "/world/state", "/world/present", "/world/walkers"];
const PAGE_POLL_ALL = ["/world/present", "/world/walkers", "/world/conversations", "/world/state"];
// --without drops a read from both lists, to tell one route's cost from the rest.
const PAGE_LOAD = PAGE_LOAD_ALL.filter((p) => !WITHOUT.has(p));
const PAGE_POLL = PAGE_POLL_ALL.filter((p) => !WITHOUT.has(p));

const PROD_HOSTS = /(^|\.)postmark\.town$|(^|\.)starforge-atelier\.online$/;

// ── the dev-only gate ───────────────────────────────────────────────────────
async function refuseUnlessDev() {
  let host;
  try { host = new URL(BASE).hostname; } catch { console.error(`party-replay: --base ${BASE} is not a URL`); process.exit(2); }
  if (PROD_HOSTS.test(host) && host !== "dev.postmark.town") {
    console.error(`party-replay: REFUSED — ${host} is the town. This tool drives the dev office only.`); process.exit(2);
  }
  if (host === "dev.postmark.town") {
    console.error("party-replay: REFUSED — dev.postmark.town is behind Cloudflare Access and nginx, and nginx makes every simulated client one address. Tunnel to the office's port: ssh -N -L 14381:127.0.0.1:4381 meepo-ec2"); process.exit(2);
  }
  let rel;
  try {
    const r = await fetch(`${BASE}/release`, { signal: AbortSignal.timeout(20_000) });
    rel = await r.json();
  } catch (e) {
    console.error(`party-replay: REFUSED — ${BASE}/release did not answer (${e?.message ?? e}); an office that cannot say what it is gets no crowd`); process.exit(2);
  }
  if (rel?.target !== "dev") {
    console.error(`party-replay: REFUSED — ${BASE}/release says target ${JSON.stringify(rel?.target)}, not "dev"`); process.exit(2);
  }
  return rel;
}

// ── the client ──────────────────────────────────────────────────────────────
const t0 = Date.now();
let open = 0;
let maxOpen = 0;
let records = [];

const ipOf = (kind, n) => `10.77.${kind === "agent" ? 1 + Math.floor(n / 250) : 100 + Math.floor(n / 250)}.${1 + (n % 250)}`;

async function call(route, url, init = {}) {
  const started = Date.now();
  open += 1; maxOpen = Math.max(maxOpen, open);
  const rec = { route, t: started - t0, ms: null, status: 0, ok: false, timed_out: false };
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = await r.text();
    rec.status = r.status;
    rec.ok = r.status < 400;
    rec.body = body;
  } catch (e) {
    rec.timed_out = e?.name === "TimeoutError";
    rec.error = String(e?.message ?? e).slice(0, 120);
  } finally {
    rec.ms = Date.now() - started;
    open -= 1;
  }
  const { body, ...kept } = rec;
  records.push(kept);
  return rec;
}

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const between = (a, b) => (a + Math.random() * (b - a)) * 1000;
let stopping = false;

// ── agents ──────────────────────────────────────────────────────────────────
const RUN = Date.now().toString(36).slice(-5);
const agents = [];

async function agent(n) {
  const ip = ipOf("agent", n);
  const mint = await call("POST /berth", `${BASE}/berth`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ slug: `replay-${RUN}-${n}` }),
  });
  let key = null;
  try { key = JSON.parse(mint.body).key; } catch { /* reported below */ }
  if (!key) { agents[n] = { n, failed: `berth mint answered ${mint.status}` }; return; }
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${key}`, "x-forwarded-for": ip };
  let id = 0;
  const rpc = (route, method, params) =>
    call(route, `${BASE}/mcp`, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
  await rpc("mcp initialize", "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "party-replay", version: "1" } });
  agents[n] = { n, speaker: `berth-replay-${RUN}-${n}` };
  await sleep(between(0, SAY_MAX));
  let said = 0;
  while (!stopping) {
    await rpc("mcp world say", "tools/call", { name: "world", arguments: { do: "say", args: { text: `the replay's voice ${n}, remark ${++said}` } } });
    await sleep(between(SAY_MIN, SAY_MAX));
  }
}

// ── viewers ─────────────────────────────────────────────────────────────────
let stacked = 0;
async function viewer(n) {
  const headers = { "x-forwarded-for": ipOf("viewer", n) };
  const get = (p) => call(`GET ${p}`, `${BASE}${p}`, { headers });
  await Promise.all(PAGE_LOAD.map(get));
  let busy = false;
  while (!stopping) {
    await sleep(POLL_S * 1000);
    if (stopping) break;
    // A page does not stack polls on itself: a tick that finds the last one
    // still out is skipped and counted, the way a browser's fetch-then-wait
    // loop behaves.
    if (busy) { stacked += 1; continue; }
    busy = true;
    Promise.all(PAGE_POLL.map(get)).finally(() => { busy = false; });
  }
}

// ── the probe ───────────────────────────────────────────────────────────────
let loopLagSeen = null;
async function probe() {
  let tick = 0;
  while (!stopping) {
    call("probe GET /release", `${BASE}/release`);
    if (tick++ % 6 === 0) {
      call("probe GET /ops/loop-lag", `${BASE}/ops/loop-lag`).then((r) => {
        if (r.ok) { try { loopLagSeen = JSON.parse(r.body).last_minute ?? loopLagSeen; } catch { /* not the shape */ } }
      });
    }
    await sleep(PROBE_MS);
  }
}

// ── the summary ─────────────────────────────────────────────────────────────
const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : null);

function summarise(rows, seconds) {
  const byRoute = new Map();
  for (const r of rows) (byRoute.get(r.route) ?? byRoute.set(r.route, []).get(r.route)).push(r);
  const routes = {};
  for (const [route, rs] of [...byRoute].sort()) {
    const ms = rs.map((r) => r.ms).sort((a, b) => a - b);
    routes[route] = { n: rs.length, p50_ms: pct(ms, 0.5), p95_ms: pct(ms, 0.95), max_ms: ms.at(-1),
      errors: rs.filter((r) => !r.ok && !r.timed_out).length, timeouts: rs.filter((r) => r.timed_out).length };
  }
  const answered = rows.filter((r) => r.ok || r.status > 0).length;
  return { responses_per_s: +(answered / Math.max(1, seconds)).toFixed(2), routes };
}

function line(s) { process.stdout.write(s + "\n"); }

async function main() {
  const rel = await refuseUnlessDev();
  line(`party-replay ${RUN} → ${BASE} (${rel.tag} @ ${rel.sha}, target ${rel.target})`);
  line(`agents are berths on the quay, not residents — a resident's movement-derived standpoint is not exercised`);
  probe();
  const steps = [];
  let collapsedAt = null;
  for (const [k, step] of STEPS.entries()) {
    while (agents.length < step.agents) { const n = agents.length; agents.push({ n }); agent(n); }
    const viewersNow = steps.reduce((m, s) => Math.max(m, s.viewers), 0);
    for (let n = viewersNow; n < step.viewers; n++) viewer(n);
    records = [];
    maxOpen = open;
    stacked = 0;
    const began = Date.now();
    await sleep(STEP_S * 1000);
    const seconds = (Date.now() - began) / 1000;
    const rows = records;
    const sum = summarise(rows.filter((r) => !r.route.startsWith("probe")), seconds);
    const probeMs = rows.filter((r) => r.route === "probe GET /release").map((r) => (r.timed_out ? TIMEOUT_MS : r.ms)).sort((a, b) => a - b);
    const backlog = { probe_p50_ms: pct(probeMs, 0.5), probe_p95_ms: pct(probeMs, 0.95), probe_max_ms: probeMs.at(-1) ?? null,
      max_open: maxOpen, open_at_end: open, viewer_polls_skipped: stacked };
    const collapsed = backlog.probe_p50_ms !== null && backlog.probe_p50_ms >= COLLAPSE_MS;
    const out = { step: k + 1, agents: step.agents, viewers: step.viewers, seconds: Math.round(seconds),
      failed_agents: agents.filter((a) => a.failed).length, ...sum, backlog, loop_lag_last_minute: loopLagSeen, collapsed };
    steps.push(out);
    line(`\n── step ${k + 1}: ${step.agents} agents, ${step.viewers} viewers, ${Math.round(seconds)} s ── ${sum.responses_per_s} responses/s · ` +
      `probe p50 ${backlog.probe_p50_ms} ms p95 ${backlog.probe_p95_ms} ms max ${backlog.probe_max_ms} ms · open max ${backlog.max_open}` +
      (stacked ? ` · ${stacked} viewer polls skipped (still waiting on the last)` : "") + (collapsed ? "  ← COLLAPSED" : ""));
    for (const [route, r] of Object.entries(sum.routes))
      line(`  ${String(r.n).padStart(5)}  p50 ${String(r.p50_ms).padStart(6)}  p95 ${String(r.p95_ms).padStart(6)}  max ${String(r.max_ms).padStart(6)}` +
        `${r.errors ? `  errors ${r.errors}` : ""}${r.timeouts ? `  timeouts ${r.timeouts}` : ""}  ${route}`);
    if (loopLagSeen) line(`  office loop lag, last minute: max ${loopLagSeen.max_ms} ms, p99 ${loopLagSeen.p99_ms} ms, blocked ${loopLagSeen.blocked_ms} ms`);
    if (collapsed && collapsedAt === null) collapsedAt = out;
    if (collapsed && STOP_ON_COLLAPSE) break;
  }
  stopping = true;
  const verdict = collapsedAt
    ? `COLLAPSE starts at ${collapsedAt.agents} agents and ${collapsedAt.viewers} viewers (step ${collapsedAt.step}): the cheapest door waited ${collapsedAt.backlog.probe_p50_ms} ms at p50`
    : `no collapse through ${STEPS.at(-1).agents} agents and ${STEPS.at(-1).viewers} viewers (probe p50 stayed under ${COLLAPSE_MS} ms)`;
  line(`\n${verdict}`);
  if (OUT) {
    writeFileSync(OUT, JSON.stringify({ run: RUN, base: BASE, release: rel, started: new Date(t0).toISOString(),
      shape: { say_s: [SAY_MIN, SAY_MAX], poll_s: POLL_S, step_s: STEP_S, timeout_ms: TIMEOUT_MS, collapse_ms: COLLAPSE_MS, page_load: PAGE_LOAD, page_poll: PAGE_POLL, without: [...WITHOUT],
        agents_are: "berths on the quay (POST /berth); residents' movement-derived standpoints are not exercised" },
      steps, verdict }, null, 1));
    line(`written: ${OUT}`);
  }
  // Requests still out are left to their own timeouts; the process does not
  // wait a minute for answers nobody will read.
  process.exit(0);
}

main().catch((e) => { console.error("party-replay:", e?.stack ?? e); process.exit(1); });
