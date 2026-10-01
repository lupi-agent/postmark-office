// claim-cap.test.mjs — the claim desk's hourly mint ceiling actually bites.
//
// WHY ITS OWN FILE AND ITS OWN SERVER. The cap is per-IP and in-memory, so it
// is process state shared by every test in a file: a ceiling test living beside
// the desk's other tests would both starve them and depend on how many of them
// ran first — testing the order of a file rather than the door. A fresh server
// on its own port is the only way to count from zero.
//
// WHY IT EXISTS AT ALL. The lane's flip run deleted the call that RECORDS a
// mint and every test stayed green: the desk's other cap test proves refusals
// do not spend a resident's budget, and nothing at all proved the budget was
// ever spent. A rate limit that never limits is a rate limit nobody is
// keeping, and the delete flip is what found it.
//
//   node --test test/claim-cap.test.mjs

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { fixtureDb } from "./fixture.mjs";
import { awaitListening } from "./spawn-office.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 43891;
const BASE = `http://127.0.0.1:${PORT}`;

// The cap is five mints an hour from one address (src/server.mjs § claimMintLimited).
const CAP = 5;
const HANDLES = Array.from({ length: CAP + 1 }, (_, i) => `capped-resident-${i}`);

let child, tmp;

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "postmark-claim-cap-"));
  const dbPath = join(tmp, "fixture.db");
  const seed = fixtureDb(dbPath);
  for (const h of HANDLES) {
    seed.prepare("INSERT INTO residents VALUES (?, ?)").run(h, JSON.stringify({
      handle: h, is_office: false, last_active: null,
      address: { data: { since: "2026-08-01", github: `${h}-keeper` }, body: `# ${h}` },
    }));
  }
  seed.close();
  const clone = join(tmp, "town-clone");
  mkdirSync(join(clone, "tools"), { recursive: true });
  writeFileSync(join(clone, "tools", "github-ids.json"), "{}");

  child = spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", String(PORT),
    "--db", dbPath, "--oauth-db", join(tmp, "oauth.db")], {
    env: { ...process.env, WORLD_GRAPH_NONE: "1", OFFICE_KEYS: "statickey=keemin:wright", TOWN_CLONE: clone, TOWN_PUSH: "", PUBLIC_BASE: BASE },
    stdio: ["ignore", "pipe", "pipe"],
  });
  // The wait that used to live here had no `error` listener and kept no
  // stderr, so every spawn-level fault arrived as "server never listened" with
  // its cause thrown away. See test/spawn-office.mjs.
  await awaitListening(child);
});

after(async () => {
  if (child && child.exitCode === null) {
    const gone = new Promise((ok) => child.on("exit", ok));
    child.kill();
    await gone;
  }
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const ask = (handle) => fetch(`${BASE}/keys/claim`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ handle }),
});

test("the hourly mint ceiling bites: five keys from one address, and the sixth is turned away", async () => {
  for (let i = 0; i < CAP; i++) {
    const r = await ask(HANDLES[i]);
    assert.equal(r.status, 201, `mint ${i + 1} of ${CAP} should land`);
  }
  // NOT interleaved with refusals here, though that is the other half of the
  // cap's contract: eleven keyless POSTs in a row trip the bouncer's own
  // keyless tier first (429 for a different and entirely correct reason), and a
  // test that cannot tell the two 429s apart is watching neither. The
  // refusals-do-not-charge half is watched in claim-desk.test.mjs, under that
  // tier's budget.

  const over = await ask(HANDLES[CAP]);
  assert.equal(over.status, 429, "the sixth mint from one address is refused");
  const body = await over.json();
  assert.match(body.defect, /busy/i);
  assert.match(body.hint, /come back shortly/i, "and it says the wait is short, not that the door is shut");

  // nothing was minted by the refused ask
  const state = await (await fetch(`${BASE}/keys/claim?handle=${HANDLES[CAP]}`)).json();
  assert.equal(state.claim, null, "a capped ask leaves no claim behind");
});
