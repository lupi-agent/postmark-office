// bouncer-server.test.mjs — the key middleware over the real HTTP door.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { fixtureDb } from "./fixture.mjs";
import { bootOnFreePort } from "./spawn-office.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// The port is asked of the OS, never chosen (spawn-office.mjs § the port,
// asked for); it was the fixed 43855, a door every pool tree on the box shares.
let PORT, BASE;
const KEY = "bouncer-test-key";
const FROZEN_BOUNCER_NOW_MS = String(Date.parse("2026-09-14T07:00:00Z"));

let child, tmp;

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "postmark-office-bouncer-"));
  const dbPath = join(tmp, "fixture.db");
  fixtureDb(dbPath).close();
  ({ child, port: PORT } = await bootOnFreePort((port) => spawn(process.execPath, [
    join(ROOT, "src", "server.mjs"),
    "--port", String(port),
    "--db", dbPath,
    "--bouncer-now-ms", FROZEN_BOUNCER_NOW_MS,
  ], {
    env: {
      ...process.env,
      OFFICE_KEYS: `${KEY}=keemin:wright`,
      OFFICE_BOUNCER_KEY_READ_PER_MINUTE: "2",
      OFFICE_BOUNCER_KEY_WRITE_PER_MINUTE: "3",
      OFFICE_BOUNCER_WORLD_WRITES_PER_HOUR: "1",
      TOWN_CLONE: join(tmp, "no-clone-here"),
      WORLD_CLONE: join(tmp, "no-world-clone"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  })));
  BASE = `http://127.0.0.1:${PORT}`;
});

after(async () => {
  if (child && child.exitCode === null) {
    const gone = new Promise((ok) => child.on("exit", ok));
    child.kill();
    await gone;
  }
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const call = (path, method = "GET") => fetch(`${BASE}${path}`, {
  method,
  headers: { authorization: `Bearer ${KEY}` },
});

const worldWalk = () => fetch(`${BASE}/mcp`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${KEY}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "world_walk", arguments: {} },
  }),
});

test("REST and MCP middleware return exact 429s with independent key and household budgets", async () => {
  assert.equal((await call("/town")).status, 200);
  assert.equal((await call("/town")).status, 200);

  // This is deliberately longer than one retry-after second. With a wall clock,
  // the bucket partially refills and the exact response below changes under
  // scheduler/CPU load. The spawned server gets a fixed bouncer clock through
  // its composition boundary so this test measures arithmetic, not elapsed time.
  await new Promise((resolve) => setTimeout(resolve, 1_100));

  const readRate = await call("/town");
  assert.equal(readRate.status, 429);
  const readBody = await readRate.json();
  assert.deepEqual(Object.keys(readBody), ["error", "defect", "retry_after_s"]);
  assert.equal(readBody.error, "rate");
  assert.equal(readBody.retry_after_s, 30);
  assert.equal(readRate.headers.get("retry-after"), "30");

  // The read bucket is empty, but the independent write bucket still has its
  // first token. With no clone, reaching the route is witnessed by its 409.
  assert.equal((await call("/letters", "POST")).status, 409);

  // The non-world write above did not touch the household cap. The first MCP
  // world write reaches dispatch (and bounces inside the absent test clone);
  // the second gets the household layer's top-level HTTP 429.
  assert.equal((await worldWalk()).status, 200);
  const householdRate = await worldWalk();
  assert.equal(householdRate.status, 429);
  const householdBody = await householdRate.json();
  assert.equal(householdBody.error, "rate");
  assert.match(householdBody.defect, /world-write cap is 1/);
  assert.equal(
    householdRate.headers.get("retry-after"),
    String(householdBody.retry_after_s)
  );

  // All three write tokens were consumed across the REST and MCP skins.
  const writeRate = await call("/letters", "POST");
  assert.equal(writeRate.status, 429);
  const writeBody = await writeRate.json();
  assert.equal(writeBody.error, "rate");
  assert.match(writeBody.defect, /write budget/);
  assert.equal(writeRate.headers.get("retry-after"), String(writeBody.retry_after_s));
});

// ── THE OTHER HALF OF THE SEAM · production still keeps a LIVE clock ─────────
//
// The test above pins the frozen clock: with --bouncer-now-ms the window never
// moves and retry_after_s is exactly 30 however loaded the box is. Nothing yet
// reads the default, and the default is the one that matters in the office: if
// --bouncer-now-ms ever acquired a value when it was not passed, every bucket
// would stop refilling and the first resident to drain one would be shut out
// for good. That failure is silent — a frozen limiter looks exactly like a
// working one until somebody hits it.
//
// So this is the same measurement with the flag absent, and it is deliberately
// an INEQUALITY rather than an exact count: any clock that moves at all makes
// it true, so load can only make the number smaller, never flaky. A frozen
// clock answers exactly 30 and nothing else can.
//
// Its own server, on its own port, asked of the OS like every office in test/
// (spawn-office.mjs § the port, asked for). It was a pid-derived berth in a band
// kept clear of every other file's by hand — a guess, and a ledger of bands
// nothing in the suite checked.

test("with no --bouncer-now-ms the office keeps Date.now — the seam is a test affordance, never a new default", async () => {
  const dir = mkdtempSync(join(tmpdir(), "postmark-office-liveclock-"));
  const dbPath = join(dir, "fixture.db");
  fixtureDb(dbPath).close();
  const { child: live, port: LIVE_PORT } = await bootOnFreePort((port) => spawn(process.execPath, [
    join(ROOT, "src", "server.mjs"),
    "--port", String(port),
    "--db", dbPath,
    // no --bouncer-now-ms: this is the production composition
  ], {
    env: {
      ...process.env,
      OFFICE_KEYS: `${KEY}=keemin:wright`,
      OFFICE_BOUNCER_KEY_READ_PER_MINUTE: "2",
      OFFICE_BOUNCER_KEY_WRITE_PER_MINUTE: "3",
      OFFICE_BOUNCER_WORLD_WRITES_PER_HOUR: "1",
      TOWN_CLONE: join(dir, "no-clone-here"),
      WORLD_CLONE: join(dir, "no-world-clone"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  }));

  try {
    const hit = (path) => fetch(`http://127.0.0.1:${LIVE_PORT}${path}`, {
      headers: { authorization: `Bearer ${KEY}` },
    });

    assert.equal((await hit("/town")).status, 200);
    assert.equal((await hit("/town")).status, 200);
    const drained = await hit("/town");
    assert.equal(drained.status, 429, "two reads is the whole budget here, as above");

    // The same wait the frozen test makes. There the answer cannot change; here
    // it must.
    await new Promise((resolve) => setTimeout(resolve, 1_100));

    const later = await hit("/town");
    assert.equal(later.status, 429, "still empty — one second does not refill a 30-second token");
    const body = await later.json();
    assert.equal(body.error, "rate");
    assert.ok(body.retry_after_s < 30,
      `a live clock must have shortened the wait; got ${body.retry_after_s}, which is what a FROZEN bouncer answers`);
    assert.equal(later.headers.get("retry-after"), String(body.retry_after_s));
  } finally {
    if (live.exitCode === null) {
      const gone = new Promise((ok) => live.on("exit", ok));
      live.kill();
      await gone;
    }
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
