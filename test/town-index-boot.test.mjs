// town-index-boot.test.mjs — a switched office has read its index before it listens.
//
// With TOWN_INDEX_READS=store the write path's checks (index-probe.mjs) and the
// sync roll readers answer from a snapshot the office loads from the store. It
// was loaded AFTER the office started listening, so the first asks after a
// restart met a process that had not read its index: a berth or a key desk
// a moment after boot answered the store's 503, and a sign-in read as
// anonymous. The office now loads both before it listens (bounded at 10 s).
//
// The ask goes out the instant the office prints that it is listening, from the
// same handler, so nothing else can give the load time to finish first.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { fixtureDb } from "./fixture.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(join(tmpdir(), "town-index-boot-"));
const dbPath = join(tmp, "office.db");
let ix;

before(async () => {
  fixtureDb(dbPath).close();
  ix = await indexStore(dbPath);
});

after(async () => {
  await ix?.stop();
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** Boot a switched office and send `ask` from the listening line's own handler. */
function askAtListen(name, ask) {
  return new Promise((ok, no) => {
    const child = spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", "0", "--db", dbPath,
      "--oauth-db", join(tmp, `${name}-oauth.db`), "--roles-db", join(tmp, `${name}-roles.db`)], {
      env: { ...process.env, ...ix.env, TOWN_CLONE: join(tmp, "no-clone-here"), WORLD_CLONE: join(tmp, "no-world-clone"),
        VOICES_LOG: join(tmp, `${name}-voices.jsonl`), TOWN_PUSH: "", OFFICE_READ_WORKERS: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const t = setTimeout(() => { child.kill(); no(new Error(`${name}: the office never listened`)); }, 30_000);
    child.stdout.on("data", (d) => {
      const m = /listening on :(\d+)/.exec(String(d));
      if (!m) return;
      clearTimeout(t);
      ask(`http://127.0.0.1:${m[1]}`).then(async (r) => {
        const body = await r.json();
        const gone = new Promise((g) => child.on("exit", g));
        child.kill();
        await gone;
        ok({ status: r.status, body });
      }, no);
    });
  });
}

test("a switched office's first ask after boot reads its index: the key desk answers 404, never the store's 503", async () => {
  const { status, body } = await askAtListen("claim", (base) =>
    fetch(`${base}/keys/claim`, { method: "POST", body: JSON.stringify({ handle: "nobody-here" }), headers: { "content-type": "application/json" } }));
  assert.equal(status, 404, JSON.stringify(body));
  assert.match(body.defect, /is not a resident of this town/);
});

test("a switched office's first berth after boot is minted, never the store's 503", async () => {
  const { status, body } = await askAtListen("berth", (base) =>
    fetch(`${base}/berth`, { method: "POST", body: JSON.stringify({ slug: "first-light" }), headers: { "content-type": "application/json" } }));
  assert.equal(status, 201, JSON.stringify(body));
});
