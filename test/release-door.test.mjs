// release-door.test.mjs — POS-60: `GET /release` over the real HTTP door.
//
// The unit falsifier (test/release-stamp.test.mjs) pins the READER. This one pins
// the DOOR, because the reader being right is worth nothing if the route does not
// exist, is not public, or is served from a hot re-read instead of the boot read.
//
// THE LAW, quoted verbatim from deploy/DEPLOY.md's live-truth note (2026-07-19):
//
//   "a code deploy is `scp src/<changed>.mjs meepo-ec2:/srv/postmark-office/src/`
//    + `sudo systemctl restart postmark-office`, then probe a route whose
//    response only the new code produces (a restart alone proves nothing)."
//
// The auto-deploy in .github/workflows/release-train.yml polls exactly this route
// and refuses to go green until it answers with the tag and sha it just shipped.
// So the three properties below are the ones that workflow's gate rests on:
//
//   1. the route answers 200 WITHOUT a key — an Actions runner probing prod, and
//      the operator on the box's loopback, both hold no household key;
//   2. it reports the tag and sha from the stamp on disk at boot;
//   3. it is BOOT-read, not hot-read — rewriting release.json under a running
//      office does NOT change the answer. That is what makes the probe a proof of
//      restart rather than a proof of file-copy.
//
//   node --test test/release-door.test.mjs

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { fixtureDb } from "./fixture.mjs";
import { bootOnFreePort } from "./spawn-office.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// The port is asked of the OS, never chosen (spawn-office.mjs § the port,
// asked for); it was the fixed 43857, a door every pool tree on the box shares.
let PORT, BASE;

const TAG = "release/2026-w35.7";
const SHA = "1234567890abcdef1234567890abcdef12345678";

let child, tmp, stampDir;

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "postmark-office-release-"));
  stampDir = tmp;
  writeFileSync(join(stampDir, "release.json"), JSON.stringify({
    tag: TAG, sha: SHA, deployed_at: "2026-08-26T09:00:00.000Z", target: "prod",
    run: "https://github.com/keeminlee/postmark-office/actions/runs/42",
  }));

  const dbPath = join(tmp, "fixture.db");
  fixtureDb(dbPath).close();
  ({ child, port: PORT } = await bootOnFreePort((port) => spawn(process.execPath, [
    join(ROOT, "src", "server.mjs"),
    "--port", String(port),
    "--db", dbPath,
    "--release-root", stampDir,
  ], {
    env: {
      ...process.env, WORLD_GRAPH_NONE: "1",
      OFFICE_KEYS: "release-door-test-key=keemin:wright",
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

test("GET /release answers 200 with no key — the deploy probe holds none", async () => {
  const res = await fetch(`${BASE}/release`);
  assert.equal(res.status, 200, "a keyed /release would make the auto-deploy's gate unrunnable");
});

test("it names the release on disk at boot", async () => {
  const body = await (await fetch(`${BASE}/release`)).json();
  assert.equal(body.deployed, true);
  assert.equal(body.tag, TAG);
  assert.equal(body.sha, SHA);
  assert.equal(body.target, "prod");
  assert.ok(body.started_at, "the door reports when this process booted");
});

test("the manifest at / advertises the door", async () => {
  const body = await (await fetch(`${BASE}/`)).json();
  assert.ok(body.reads.includes("/release"), "an unadvertised door is one the next operator cannot find");
});

// THE LOAD-BEARING ONE. If this ever fails, the probe has stopped proving a
// restart and started proving a file-copy — which the old code passes too.
test("rewriting release.json under a LIVE office does not change the answer", async () => {
  writeFileSync(join(stampDir, "release.json"), JSON.stringify({
    tag: "release/2026-w99-IMPOSTOR", sha: "f".repeat(40),
  }));
  const body = await (await fetch(`${BASE}/release`)).json();
  assert.equal(body.tag, TAG, "a hot re-read would let new bytes on disk pass as a restarted office");
  assert.equal(body.sha, SHA);
});
