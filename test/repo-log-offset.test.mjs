// repo-log-offset.test.mjs — GET /repo/log walks with offset, at the door.
//
// queries.repoLog has read `offset` since 2026-08-25, and its page tells the
// caller "call again with offset: N". The HTTP door built its opts without it,
// so every offset served page one and echoed offset: 0. This drives the door
// itself, over HTTP, against the fixture's three commits.
//   node --test test/repo-log-offset.test.mjs

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
let child, tmp, BASE;

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "postmark-office-repo-log-"));
  const dbPath = join(tmp, "fixture.db");
  fixtureDb(dbPath).close();
  let port;
  ({ child, port } = await bootOnFreePort((p) => spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", String(p), "--db", dbPath,
    "--oauth-db", join(tmp, "oauth.db"), "--roles-db", join(tmp, "roles.db")], {
    env: { ...process.env, TOWN_CLONE: join(tmp, "no-clone-here"), WORLD_CLONE: join(tmp, "no-world-clone"),
      VOICES_LOG: join(tmp, "voices.jsonl"), TOWN_PUSH: "", WORLD_STORE_DB: join(tmp, "no-world.db"),
      OFFICE_READ_WORKERS: "0", TOWN_INDEX_READS: undefined, WORLD2_PG: undefined, WORLD2_PG_URL: undefined },
    stdio: ["ignore", "pipe", "pipe"],
  })));
  BASE = `http://127.0.0.1:${port}`;
});

after(async () => {
  if (child && child.exitCode === null) {
    const gone = new Promise((ok) => child.on("exit", ok));
    child.kill();
    await gone;
  }
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("GET /repo/log?offset= walks past page one, and echoes the offset it served", async () => {
  // CAN FAIL: drop `offset` from the door's opts and every page is page one.
  const page = async (q) => (await fetch(`${BASE}/repo/log?${q}`)).json();
  const first = await page("limit=1");
  assert.equal(first.offset, 0);
  assert.equal(first.next_offset, 1);
  const shas = [first.commits[0].sha];
  for (const off of [1, 2]) {
    const p = await page(`limit=1&offset=${off}`);
    assert.equal(p.offset, off, `offset ${off} is echoed`);
    shas.push(p.commits[0].sha);
  }
  assert.deepEqual(shas, ["c3sha", "c2sha", "c1sha"], "following next_offset reads the whole history once, newest first");
});
