// loop-lag.test.mjs — POS-267: the office reports how long its one thread keeps
// a caller waiting, and the roll-call's heartbeat goes stale while it does.
//
// The minute rows are driven through a planted histogram, so a test never
// waits a real minute. The door is driven over real HTTP, because a module
// that is right is worth nothing if the route does not answer keyless.
//
//   node --test test/loop-lag.test.mjs

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { fixtureDb } from "./fixture.mjs";
import { createLoopLag, LAG_ALARM_MS, MINUTE_MS, stateFileFor } from "../src/loop-lag.mjs";

const T0 = Date.parse("2026-09-27T01:00:00Z");

// A histogram with the four readings the module takes, in nanoseconds.
function planted() {
  const h = { count: 0, p50: 0, p99: 0, max: 0, mean: 0, resets: 0 };
  h.percentile = (p) => (p === 50 ? h.p50 : h.p99);
  h.reset = () => { h.resets += 1; };
  h.enable = () => {};
  h.set = ({ count, p50, p99, max, mean }) => Object.assign(h, { count, p50: p50 * 1e6, p99: p99 * 1e6, max: max * 1e6, mean: mean * 1e6 });
  return h;
}

function clock() {
  let t = T0;
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  return now;
}

test("a calm minute moves calm_at; a minute with one 48 s stall does not, though its p99 is calm", () => {
  const h = planted();
  const now = clock();
  const lag = createLoopLag({ histogram: h, now });

  now.advance(MINUTE_MS);
  h.set({ count: 3000, p50: 20, p99: 40, max: 180, mean: 21 });
  const calm = lag.tick();
  assert.equal(calm.over, false);
  assert.equal(lag.read().calm_at, calm.at);
  assert.equal(h.resets, 1, "the histogram was not reset after its minute was read");

  // The dev office's /world/present, 2026-09-27: one synchronous 48 s read.
  // Thousands of on-time samples around it keep p99 low, which is why the row
  // is judged on max. Judged on p99, this minute would read calm.
  now.advance(MINUTE_MS);
  h.set({ count: 600, p50: 20, p99: 45, max: 48_000, mean: 100 });
  const stalled = lag.tick();
  assert.ok(stalled.p99_ms < LAG_ALARM_MS, "the planted stall is not the p99-hides-it shape this test is about");
  assert.equal(stalled.over, true);
  assert.equal(stalled.max_ms, 48_000);
  assert.equal(stalled.blocked_ms, 60_000);
  assert.equal(lag.read().calm_at, calm.at, "calm_at moved on a minute where a caller waited 48 s");
  assert.deepEqual(lag.read().worst_24h, { at: stalled.at, max_ms: 48_000, blocked_ms: 60_000 });
});

test("the threshold is the boundary: max exactly at LAG_ALARM_MS is over, one below is calm", () => {
  const h = planted();
  const now = clock();
  const lag = createLoopLag({ histogram: h, now });
  now.advance(MINUTE_MS);
  h.set({ count: 100, p50: 20, p99: 30, max: LAG_ALARM_MS - 1, mean: 20 });
  assert.equal(lag.tick().over, false);
  now.advance(MINUTE_MS);
  h.set({ count: 100, p50: 20, p99: 30, max: LAG_ALARM_MS, mean: 20 });
  assert.equal(lag.tick().over, true);
});

test("a restart carries calm_at and the day's worst from the file; a worst a day old is dropped", () => {
  const dir = mkdtempSync(join(tmpdir(), "loop-lag-"));
  const file = join(dir, "loop-lag-4380.json");
  try {
    const now = clock();
    const h1 = planted();
    const a = createLoopLag({ file, histogram: h1, now });
    now.advance(MINUTE_MS);
    h1.set({ count: 100, p50: 20, p99: 30, max: 90, mean: 20 });
    const calmRow = a.tick();
    now.advance(MINUTE_MS);
    h1.set({ count: 10, p50: 20, p99: 30, max: 22_000, mean: 2300 });
    a.tick();

    // The rehydrate timer bounces the office; the new process must not read as
    // calm merely because it is new.
    const b = createLoopLag({ file, histogram: planted(), now });
    assert.equal(b.read().calm_at, calmRow.at);
    assert.equal(b.read().worst_24h.max_ms, 22_000);
    assert.deepEqual(b.read().minutes, [], "per-minute rows are this process's own");

    now.advance(24 * 60 * MINUTE_MS);
    const c = createLoopLag({ file, histogram: planted(), now });
    assert.equal(c.read().worst_24h, null, "a worst older than a day was carried");
    c.write();

    const onDisk = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(onDisk.threshold_ms, LAG_ALARM_MS);
    assert.ok("calm_at" in onDisk, "the roll-call's stamp field is missing from the file");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the roll-call row reads the file this module writes, by the stamp this module sets", () => {
  const manifest = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "deploy", "box-rollcall-manifest.json"), "utf8"));
  const row = manifest.units.find((r) => r.heartbeat?.path === "/srv/postmark-office/telemetry/loop-lag-4380.json");
  assert.ok(row, "no roll-call row reads the prod office's loop-lag file");
  assert.equal(row.unit, "postmark-office.service");
  assert.equal(row.heartbeat.stamp_field, "calm_at");
  assert.ok(stateFileFor(4380).endsWith(join("telemetry", "loop-lag-4380.json")));
});

// ── the door ─────────────────────────────────────────────────────────────────

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 43871;
let child, tmp;

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "postmark-office-loop-lag-"));
  const dbPath = join(tmp, "fixture.db");
  fixtureDb(dbPath).close();
  writeFileSync(join(tmp, "release.json"), JSON.stringify({ tag: "t", sha: "s", target: "dev" }));
  child = spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", String(PORT), "--db", dbPath, "--release-root", tmp], {
    env: { ...process.env, OFFICE_KEYS: "loop-lag-test-key=keemin:wright", TOWN_CLONE: join(tmp, "no-clone"), WORLD_CLONE: join(tmp, "no-world") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((ok, no) => {
    const timeout = setTimeout(() => no(new Error("server never listened")), 10_000);
    child.stdout.on("data", (d) => { if (String(d).includes("listening")) { clearTimeout(timeout); ok(); } });
    child.on("exit", (code) => no(new Error(`server exited early (${code})`)));
  });
});

after(async () => {
  if (child && child.exitCode === null) {
    const gone = new Promise((ok) => child.on("exit", ok));
    child.kill();
    await gone;
  }
  rmSync(tmp, { recursive: true, force: true });
  rmSync(stateFileFor(PORT), { force: true });
});

test("GET /ops/loop-lag answers keyless, and a process younger than a minute writes no file", async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/ops/loop-lag`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.threshold_ms, LAG_ALARM_MS);
  assert.ok(Number.isFinite(Date.parse(body.started_at)));
  assert.ok(Array.isArray(body.minutes));
  assert.equal(body.last_minute, null);
  assert.equal(existsSync(stateFileFor(PORT)), false, "the office wrote its state file before its first minute");
});
