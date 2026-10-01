// metrics.test.mjs — the mail-pulse verb and keyless backstop over real HTTP.
// A dedicated office is spawned with a small test-only burst so the 429 path is
// cheap to drive; credentialed and keyless callers own separate buckets.
//   node --test test/

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { fixtureDb } from "./fixture.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 43833;
const BASE = `http://127.0.0.1:${PORT}`;
const KEY = "testkey";

let child, tmp;

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "postmark-office-metrics-"));
  const dbPath = join(tmp, "fixture.db");
  fixtureDb(dbPath).close();
  child = spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", String(PORT), "--db", dbPath], {
    env: {
      ...process.env, WORLD_GRAPH_NONE: "1",
      OFFICE_KEYS: `${KEY}=keemin:wright`,
      OFFICE_BOUNCER_KEYLESS_PER_MINUTE: "3",
      OFFICE_BOUNCER_KEYLESS_BURST: "3",
      TOWN_CLONE: join(tmp, "no-clone-here"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error("server never listened")), 10_000);
    child.stdout.on("data", (d) => { if (String(d).includes("listening")) { clearTimeout(t); ok(); } });
    child.on("exit", (c) => no(new Error(`server exited early (${c})`)));
  });
});

after(async () => {
  if (child && child.exitCode === null) {
    const gone = new Promise((ok) => child.on("exit", ok));
    child.kill();
    await gone;
  }
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

// authenticated → bypasses the limiter
const auth = (path) => fetch(`${BASE}${path}`, { headers: { authorization: `Bearer ${KEY}` } });

test("GET /metrics/mail: deterministic as_of, 60 zero-filled days, totals, active threads", async () => {
  const m = await (await auth("/metrics/mail")).json();
  assert.equal(m.as_of, "2026-07-03"); // newest ledger date, not the wall clock
  assert.equal(m.days.length, 60);
  assert.equal(m.days.at(-1).date, "2026-07-03");
  assert.equal(m.days.at(-1).deliveries, 1);

  const jul2 = m.days.find((d) => d.date === "2026-07-02");
  assert.deepEqual(jul2, { date: "2026-07-02", deliveries: 1, bounces: 1 });

  const gap = m.days.find((d) => d.date === "2026-06-20"); // no ledger activity
  assert.deepEqual(gap, { date: "2026-06-20", deliveries: 0, bounces: 0 });

  assert.deepEqual(m.totals, { deliveries: 3, bounces: 1, letters: 6, threads: 1, residents: 3 });
  assert.equal(m.active_threads, 1); // the one thread's last letter is within 14 days
});

test("keyless GETs are rate-limited with the exact 429 shape; a key has its own budget", async () => {
  // Test burst=3: the first three keyless hits pass, the fourth trips.
  let last;
  for (let i = 0; i < 4; i++) last = await fetch(`${BASE}/town`);
  assert.equal(last.status, 429);
  const body = await last.json();
  assert.deepEqual(Object.keys(body), ["error", "defect", "retry_after_s"]);
  assert.equal(body.error, "rate");
  assert.ok(body.retry_after_s >= 1);
  assert.equal(last.headers.get("retry-after"), String(body.retry_after_s));

  // Credentialed calls use the separate per-key layer.
  assert.equal((await auth("/town")).status, 200);
});
