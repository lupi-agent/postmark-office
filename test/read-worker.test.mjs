// read-worker.test.mjs — DEC-4's own gate, in its own words.
//
//   "Gate the read workers with a falsifier asserting they hold no write grant
//    and open no sqlite handle in write mode."
//        — runbook.md § DEC-4, founder-recommended, standing unopposed
//
// The claim has three limbs and this file walks all three against a REAL booted
// worker over its real HTTP door. None of them is checked by reading source
// text: a check on the code's text is not a check on its behaviour, so every
// leg here drives the process and reads what came back.
//
//   § 1  the ROUTE refusal — every unsafe door answers 405 and names the writer
//   § 2  the READ half — the worker-safe doors still answer, so the refusal is
//        a gate and not a wall (a worker that refused everything would pass a
//        route test and be worthless)
//   § 3  NO SQLITE HANDLE IN WRITE MODE — the store is made genuinely unwritable
//        underneath the running worker and its reads are asked to keep working.
//        This is the leg that can actually fail, and it did before the fix.
//   § 4  NO WRITE GRANT — the pen token is present in the worker's environment
//        and absent from the worker.
//
// THE FLIP THIS FILE IS BUILT AGAINST: remove `--role read` from the boot args
// in § 1 and the whole section goes red, because a writer answers those doors.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { fixtureDb } from "./fixture.mjs";
import { workerSafe, penTokenFor } from "../src/role.mjs";
import { openOauthDb } from "../src/oauth.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ⚑ THE PORTS ARE DERIVED FROM THE PID, and this comment says so because the
// last one did not. It read "THE PORTS ARE ASKED FOR ... the kernel is asked for
// three free ports" — describing an approach I wrote, found broken
// (`server.listen(0)` does not know its port until the 'listening' event, so
// `.address()` reads null) and replaced with this one, WITHOUT rewriting the
// prose above it. A comment describing the approach you ABANDONED is worse than
// none: it tells a reviewer to stop reading at the line that is actually there.
//
// Why derived at all: this file boots up to three servers, and an earlier draft
// pinned them at 43861-43863. 43861 is `hot-reload.test.mjs`'s port — safe only
// because the suite runs at concurrency 1 — and this file failed all ten legs
// against a second concurrent run of ITSELF, which for a minute read like a real
// defect. A reviewer runs this file once per flip while other lanes' suites share
// the machine, so a fixed port here is a flake I would be handing them.
//
// The base is 46000, ABOVE the neighbourhood: sixteen fixed ports live between
// 43000 and 43999 across twelve other test files, and the previous derivation
// (43000 + pid*7 % 2000) landed squarely inside them. Nothing in test/ sits above
// 44000. The stride of 7 keeps two adjacent pids seven apart, which is more than
// the three ports this file uses. Not a guarantee — a collision is still
// possible — but it is a small chance where a fixed port was a certainty.
const PORT = 46000 + ((process.pid * 7) % 2000);
const BASE = `http://127.0.0.1:${PORT}`;
const KEY = "read-worker-test-key";
const PEN = "ghp_a_token_a_read_worker_must_not_hold";
const WRITER = "https://postmark.town/api";

let child, tmp, dynPath;

const boot = (extraArgs, extraEnv = {}) => new Promise((ok, no) => {
  // The env is built ONCE and handed back with the process, so §4 can assert
  // about the environment THIS WORKER was started with. Reading
  // `process.env` there would have been an assertion about the test runner —
  // the right check aimed at the wrong object, which is the defect this whole
  // file exists to catch.
  const env = {
    ...process.env,
    OFFICE_KEYS: `${KEY}=keemin:wright`,
    POSTMARK_PEN_TOKEN: PEN,
    WORLD_DYNAMIC_DB: dynPath,
    TOWN_CLONE: join(ROOT, "town-clone"),
    WORLD_CLONE: join(tmp, "no-world-clone"),
    ...extraEnv,
  };
  const proc = spawn(process.execPath, [
    join(ROOT, "src", "server.mjs"),
    "--port", String(PORT),
    "--db", join(tmp, "fixture.db"),
    "--oauth-db", join(tmp, "oauth.db"),
    "--roles-db", join(tmp, "roles.db"),
    ...extraArgs,
  ], { env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  const t = setTimeout(() => no(new Error(`server never listened; stdout was: ${out}`)), 20_000);
  proc.stdout.on("data", (d) => {
    out += String(d);
    if (out.includes("listening")) { clearTimeout(t); ok({ proc, line: out, env }); }
  });
  proc.on("exit", (c) => no(new Error(`server exited early (${c})`)));
});

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "postmark-read-worker-"));
  fixtureDb(join(tmp, "fixture.db")).close();
  dynPath = join(tmp, "dynamic.db");
  // A real dynamic store, built by the ordinary WRITER path, so § 3 has
  // something to make unwritable. Built before the worker boots: a read worker
  // that had to create its own store would be the bug under test.
  const { openDynamic } = await import("../src/dynamic-store.mjs");
  openDynamic(dynPath).close();
  // The key store, created by the WRITER's opener — which is the only process
  // allowed to create it. A read worker refuses to boot without it (see the
  // note at server.mjs's `OAUTH_DB_PATH`), and § 0 below proves that refusal.
  const { openOauthDb } = await import("../src/oauth.mjs");
  openOauthDb(join(tmp, "oauth.db")).close();

  const booted = await boot(["--role", "read", "--writer", WRITER]);
  child = booted.proc;
  globalThis.__bootLine = booted.line;
  globalThis.__bootEnv = booted.env;
});

after(async () => {
  if (child && child.exitCode === null) {
    const gone = new Promise((ok) => child.on("exit", ok));
    child.kill();
    await gone;
  }
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/**
 * Wait for a spawned process to exit, WITH AN UPPER BOUND (reviewer's repair A,
 * lap 5).
 *
 * ⚑ WHY THIS EXISTS. The two boot-refusal legs waited on `p.on("exit")` and
 * nothing else. That is correct only while the process really does exit — and
 * the whole point of those legs is a process that MUST exit, so the case they
 * are written to catch is precisely the case that hangs them. The flip proved
 * it: F14 removed the boot guard, the worker booted and served happily, the leg
 * waited forever, and `timeout` killed the run at 300 s. It was scored RED, and
 * it was red for the wrong reason — the harness reporting a hang as a failure,
 * which is luck rather than a test.
 *
 * THIS IS THE SAME CLASS AS THE SUITE FILE THAT WAITS ON A SOCKET FOREVER and
 * cost this lane an hour tonight, and I wrote that lesson down before writing
 * this leg. **A wait with no upper bound is not a test; it is a hope with a
 * stack trace.** A booting worker now reads as RED, with a sentence saying it
 * booted when it should have refused.
 */
const exitedWithin = (p, ms, what) => new Promise((ok) => {
  const t = setTimeout(() => {
    try { p.kill(); } catch { /* already gone */ }
    ok({ code: null, timedOut: true, what });
  }, ms);
  p.on("exit", (code) => { clearTimeout(t); ok({ code, timedOut: false, what }); });
});

// Every fetch in this file is bounded too, for the same reason and because §1's
// 15 s red under machine contention had the same shape: an unbounded wait on a
// saturated box is indistinguishable from a broken door.
const FETCH_MS = 20_000;
const call = (path, init = {}) => fetch(`${BASE}${path}`, {
  signal: AbortSignal.timeout(FETCH_MS),
  ...init,
  headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", ...(init.headers ?? {}) },
});

// ── § 0 · a worker will not create what the writer owns ─────────────────────

test("§0 a read worker refuses to boot without the writer's key store", async () => {
  // The alternative shape — boot and 401 every signed-in reader — is a pool
  // member that poisons quietly, because nginx cannot tell and keeps sending it
  // traffic. This asserts the LOUD failure, and that the worker did not create
  // the file it was missing.
  const absent = join(tmp, "no-such-oauth.db");
  const p = spawn(process.execPath, [
    join(ROOT, "src", "server.mjs"), "--port", String(PORT + 2),
    "--db", join(tmp, "fixture.db"), "--oauth-db", absent,
    "--roles-db", join(tmp, "roles.db"), "--role", "read",
  ], { env: { ...process.env, OFFICE_KEYS: `${KEY}=keemin:wright`, WORLD_DYNAMIC_DB: dynPath,
    TOWN_CLONE: join(ROOT, "town-clone"), WORLD_CLONE: join(tmp, "no-world-clone") },
    stdio: ["ignore", "pipe", "pipe"] });
  const r = await exitedWithin(p, 15_000, "absent key store");
  assert.equal(r.timedOut, false, "the worker BOOTED and kept serving where it should have refused — a hang is not a pass");
  assert.equal(r.code, 78, "EX_CONFIG — a misconfigured worker exits, it does not serve");
  assert.equal(existsSync(absent), false, "and it created nothing on its way out");
});

test("§0b a read worker refuses to boot on an ABSENT dynamic store", async () => {
  // Reviewer's repair 1, and the driving is what made it a repair: two workers
  // side by side, one at the real store and one at a path that does not exist,
  // BOTH booted and BOTH answered 200 — and the misconfigured one silently
  // dropped the whole `stands` block, `stands: null` where its twin had an
  // answer. Behind nginx that is a pool member serving quietly wrong readings
  // to a share of the town with nothing in the answer saying so.
  //
  // The null-as-empty opener STAYS: an absent journal at read time is the
  // world's news and a reader may state it. What changed is WHOSE MISTAKE the
  // absence is. At boot, with an operator-named path, it is the operator's —
  // and a process that cannot see the store it was pointed at must not take
  // traffic. Same rule and same exit code as the key store's.
  const absent = join(tmp, "no-such-dir", "dynamic.db");
  const p = spawn(process.execPath, [
    join(ROOT, "src", "server.mjs"), "--port", String(PORT + 3),
    "--db", join(tmp, "fixture.db"), "--oauth-db", join(tmp, "oauth.db"),
    "--roles-db", join(tmp, "roles.db"), "--role", "read",
  ], { env: { ...process.env, OFFICE_KEYS: `${KEY}=keemin:wright`, WORLD_DYNAMIC_DB: absent,
    TOWN_CLONE: join(ROOT, "town-clone"), WORLD_CLONE: join(tmp, "no-world-clone") },
    stdio: ["ignore", "pipe", "pipe"] });
  const r = await exitedWithin(p, 15_000, "absent dynamic store");
  assert.equal(r.timedOut, false, "the worker BOOTED on a store that is not there — this is the flip's own case and it must read RED, not hang");
  assert.equal(r.code, 78, "EX_CONFIG — a worker that cannot see its store does not serve");
  assert.equal(existsSync(absent), false, "and it created nothing on its way out");
});

// ── § 1 · the route refusal ─────────────────────────────────────────────────

// Every shape of write the office has a door for. Not a sample: the list is
// taken from the manifest's own `writes` array plus the two doors that write
// without appearing there (/mcp, /keys), so a door added to the manifest and
// not to this list is a gap somebody has to explain rather than one that hides.
const UNSAFE = [
  ["POST", "/letters"], ["POST", "/votes/stake"], ["POST", "/residency"],
  ["POST", "/households"], ["POST", "/household"], ["POST", "/berth"],
  ["POST", "/media"], ["POST", "/keys"], ["POST", "/ops/gift"],
  ["POST", "/world/marks"], ["POST", "/world/walks"], ["POST", "/world/say"],
  ["POST", "/world/stake"], ["POST", "/world/unstake"], ["POST", "/world/notes"],
  ["POST", "/world/hold"], ["POST", "/world/apex"], ["POST", "/fund/verify"],
  ["POST", "/blessings"],
  ["PATCH", "/address/wright"], ["PATCH", "/home/wright"], ["PATCH", "/profile/wright"],
  ["PATCH", "/window/wright"], ["PATCH", "/profile/wright/avatar"], ["PATCH", "/home/wright/image"],
  ["POST", "/mcp"],
  // The oauth dance's first act is sweep(odb) — three DELETEs. A GET here is a
  // write, which is exactly why it is a named hole in `workerSafe` rather than
  // something the method rule catches.
  ["GET", "/oauth/authorize"], ["GET", "/.well-known/oauth-protected-resource"],
  ["GET", "/.well-known/openid-configuration"],
];

test("§1 a read worker refuses every write door with 405 and names the writer", async () => {
  const answers = [];
  for (const [method, path] of UNSAFE) {
    const res = await call(path, { method, body: method === "GET" ? undefined : "{}" });
    const body = await res.json().catch(() => ({}));
    answers.push({ method, path, status: res.status, hint: body.hint ?? "", defect: body.defect ?? "" });
  }
  const wrong = answers.filter((a) => a.status !== 405);
  assert.equal(wrong.length, 0, `these doors did not answer 405: ${JSON.stringify(wrong, null, 1)}`);
  const unaddressed = answers.filter((a) => !a.hint.includes(WRITER));
  assert.equal(unaddressed.length, 0,
    `a refusal that does not say where the writer is turns a pool into a guessing game: ${JSON.stringify(unaddressed, null, 1)}`);
  assert.ok(answers.every((a) => a.defect === "this office reads only"), "every refusal carries the same sentence");
});

test("§1b the refusal is the ROLE's, not the router's — a writer answers these doors", async () => {
  // The control for § 1. Without it, § 1 passes just as happily against a
  // server that 405s these paths for some unrelated reason — and three of them
  // (the oauth trio) are GETs a writer really does serve, so the difference is
  // the whole claim. Booted on a second port so the worker under test is
  // untouched.
  const proc = await new Promise((ok, no) => {
    const p = spawn(process.execPath, [
      join(ROOT, "src", "server.mjs"), "--port", String(PORT + 1),
      "--db", join(tmp, "fixture.db"), "--oauth-db", join(tmp, "oauth-w.db"),
      "--roles-db", join(tmp, "roles-w.db"),
    ], {
      env: { ...process.env, OFFICE_KEYS: `${KEY}=keemin:wright`, POSTMARK_PEN_TOKEN: PEN,
        WORLD_DYNAMIC_DB: dynPath, TOWN_CLONE: join(ROOT, "town-clone"), WORLD_CLONE: join(tmp, "no-world-clone") },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    const t = setTimeout(() => no(new Error("control server never listened")), 20_000);
    p.stdout.on("data", (d) => { out += String(d); if (out.includes("listening")) { clearTimeout(t); ok(p); } });
    p.on("exit", (c) => no(new Error(`control exited early (${c})`)));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${PORT + 1}/.well-known/openid-configuration`);
    assert.notEqual(res.status, 405, "the writer must SERVE oauth discovery — otherwise §1 proves nothing about the role");
    await res.text();

    // ⚑ THE OTHER POLE OF THE GRANT, and §4 is worthless without it. Flip F6b
    // hardcoded `write_grant: false` at /release and the suite stayed GREEN,
    // because false is the TRUE answer for a worker — an assertion that only
    // ever reads the read role cannot tell a disclosure from a constant. The
    // writer must say the opposite through the same line of code.
    const rel = await (await fetch(`http://127.0.0.1:${PORT + 1}/release`)).json();
    assert.equal(rel.role, "write");
    assert.equal(rel.write_grant, true,
      "the WRITER holds a pen and must say so — otherwise `write_grant` is a constant wearing a disclosure's clothes");
    assert.equal(rel.writes_at, undefined, "only a worker names somewhere else to write");
  } finally {
    const gone = new Promise((ok) => proc.on("exit", ok));
    proc.kill();
    await gone;
  }
});

// ── § 2 · the read half still works ─────────────────────────────────────────

test("§2 the worker-safe doors still answer — the role is a gate, not a wall", async () => {
  const SAFE = ["/", "/release", "/town", "/residents", "/residents/wright", "/mail/wright",
    "/letters", "/bulletin", "/stamps", "/regions", "/repo/log", "/metrics/mail",
    "/search?q=gap", "/doorstep/wright", "/me", "/ops/whoami"];
  const bad = [];
  for (const p of SAFE) {
    const res = await call(p);
    await res.text();
    if (res.status !== 200) bad.push(`${p} -> ${res.status}`);
  }
  assert.equal(bad.length, 0, `read doors that stopped answering: ${bad.join(", ")}`);
});

test("§2c GET /world/holdings is a door and not a rumour (#2599)", async () => {
  // ⚑ THIS LEG EXISTS BECAUSE § 3 WAS DRIVING A DOOR THAT WAS NOT THERE. The
  // handler sat in the write tier, 380 lines below the GET catch-all, so every
  // GET was answered by "no such door" while the manifest advertised the route
  // — and § 3's "not a 500" held just as firmly against a 404 as it would have
  // with the whole store on fire. The route is alive now, so it gets a leg that
  // asks whether it ANSWERS rather than one that asks whether it did not trip.
  //
  // It is asked HERE, on a read worker, on purpose: this read used to hold a
  // write-mode handle on the dynamic store, which is the handle DEC-4 forbids
  // this process. Waking the route without changing the mode would have made it
  // the sixth write-mode reader, so the door and the handle are one claim.
  const keyed = await call("/world/holdings");
  const body = await keyed.json().catch(() => ({}));
  assert.equal(keyed.status, 200, `the manifest advertises this read: ${JSON.stringify(body).slice(0, 160)}`);
  assert.equal(body.handle, "wright", "it answers for the key's own resident");
  assert.ok(Array.isArray(body.holding), "and in the shape the tool describes: a list of things in hand");
  assert.equal(typeof body.count, "number", "with the true count beside the page");

  // The other pole. Without it a handler that answered 200 to everything would
  // pass the line above — and the point of the fix is that the request is
  // ADJUDICATED, which a stranger can only observe as a refusal that names
  // itself. What must never come back is the catch-all: that is the answer the
  // dead route gave, and it is indistinguishable from the door not existing.
  const anon = await fetch(`${BASE}/world/holdings`, { signal: AbortSignal.timeout(FETCH_MS) });
  const anonBody = await anon.json().catch(() => ({}));
  assert.notEqual(anon.status, 404,
    `a stranger was told the door does not exist — that is the #2599 answer: ${JSON.stringify(anonBody).slice(0, 160)}`);
  assert.equal(anon.status, 401, `these hands are somebody's: ${JSON.stringify(anonBody).slice(0, 160)}`);
  assert.doesNotMatch(String(anonBody.defect ?? ""), /no such door/,
    "the refusal must be this door's own sentence, not the catch-all's");

  // AND THE TWO ROUTE LISTS MUST AGREE ABOUT IT. The office publishes the read
  // twice — in the manifest at GET /, and in the hint the catch-all hands
  // whoever knocked on nothing — and the whole shape of #2599 was those two
  // lists disagreeing with nobody able to say which was true.
  const manifest = await (await call("/")).json();
  assert.ok(manifest.reads.includes("/world/holdings"), "the manifest names the read");
  const missing = await call("/world/no-such-door-at-all");
  const hint = String((await missing.json().catch(() => ({}))).hint ?? "");
  assert.match(hint, /\/world\/holdings\b/,
    "the catch-all's door list must name it too — one office, one answer to 'what can I read'");
});

test("§2b HEAD is judged as the GET it mirrors", async () => {
  // The refusal sits after the HEAD→GET rewrite deliberately. If it sat before,
  // every HEAD would be refused as a non-GET method — and a HEAD probe of a
  // public read is how the site's sentinel checks this door is alive.
  const res = await call("/town", { method: "HEAD" });
  assert.equal(res.status, 200);
});

// ── § 3 · no sqlite handle in write mode ────────────────────────────────────

test("§3 the store is unwritable underneath the worker and the reads keep working", async (t) => {
  // THE ONLY HONEST WAY TO ASK THIS QUESTION. node:sqlite does not expose a
  // handle's mode, so "opens no handle in write mode" cannot be read off an
  // object — it has to be MADE TRUE OR FALSE by the world. So: make the store
  // genuinely unwritable, then ask the worker to read it.
  //
  // Before this lane's fix to world-apex.mjs, four pure readers opened this
  // file in write mode, and a write-mode open of an unwritable store throws at
  // the PRAGMA. Their callers all swallow it, so the failure was silent — which
  // is why this leg asserts on the ANSWER and not on an absence of errors.
  const { execFileSync } = await import("node:child_process");
  const files = [dynPath, dynPath + "-wal", dynPath + "-shm"].filter(existsSync);
  const attrib = (flag) => { for (const f of files) { try { execFileSync("attrib", [flag, f]); } catch { /* not windows */ } } };
  const chmod = async (mode) => {
    const { chmodSync } = await import("node:fs");
    for (const f of files) { try { chmodSync(f, mode); } catch { /* best effort */ } }
  };

  // Prove the mechanism BITES before trusting what it says. A leg whose
  // read-only condition is not actually read-only is the control wearing a
  // costume — this exact probe was run with chmod alone first and it did not
  // bite on Windows, which is why `attrib` is here beside it.
  attrib("+R"); await chmod(0o444);
  let bites = false;
  try {
    const probe = new DatabaseSync(dynPath);
    try { probe.exec("CREATE TABLE IF NOT EXISTS g3_probe (x)"); } catch { bites = true; }
    probe.close();
  } catch { bites = true; }

  if (!bites) {
    attrib("-R"); await chmod(0o644);
    t.skip("this filesystem would not make the store unwritable — the leg cannot fail here, so it must not claim to pass");
    return;
  }

  try {
    // ⚑ THE DOOR THIS DRIVES MUST BE ALIVE, AND THE OLD ONE WAS NOT (reviewer's
    // repair 4). This leg used to call `GET /world/holdings`, which was DEAD at
    // every office: its handler sat in the write tier, below the GET tier's
    // catch-all 404 — while the manifest advertised it as a read. So the
    // assertion "not a 500" was being made about a 404 from the catch-all, and
    // would have held just as firmly with the whole store on fire.
    //
    // THAT ROUTE IS ALIVE NOW (#2599, fixed on the w39 train) and § 2c drives
    // it. This leg stays on `/world/dynamic` regardless: the two ask different
    // questions, and a leg about an unwritable store should not also be the
    // only leg holding a route honest. The reasoning below is kept because it
    // is the reasoning, not because the route is still dead.
    //
    // `/world/dynamic` is live in the GET tier (:1058) and its answer reports
    // the store by path, so it is a door that actually looks at the thing this
    // leg is about.
    const res = await call("/world/dynamic");
    const body = await res.json().catch(() => ({}));

    // AND THE GUARD THAT WOULD HAVE CAUGHT THE DEAD DOOR: prove the probe
    // reached a real handler before trusting what it said. The catch-all's
    // hint begins "GET /town ..." and names the whole read tier; a live door
    // never answers that. A probe that cannot tell "the door said fine" from
    // "there is no door" is asserting nothing.
    assert.notEqual(res.status, 404,
      `this leg drove a door that does not exist — the catch-all answered: ${JSON.stringify(body).slice(0, 120)}`);
    assert.notEqual(res.status, 500,
      `a read against an unwritable store tripped the office: ${JSON.stringify(body).slice(0, 200)}`);

    const town = await call("/town");
    assert.equal(town.status, 200, "the index reads must be untouched by an unwritable world store");
    await town.text();
  } finally {
    attrib("-R"); await chmod(0o644);
  }
});

test("§3b ALL SEVEN store readers ask for a READ handle, and the ask is load-bearing", async () => {
  // ⚑ THE TITLE SAID FOUR AND THE BODY DROVE ONE (reviewer's repair C, lap 5).
  // And my first fix of that said FIVE over a loop of SIX — the same defect,
  // committed inside the repair for it, which is how little attention a title
  // gets even from someone who has just been told to read one. The count is
  // asserted at the bottom now, so the title and the loop cannot drift again
  // without something going red.
  // A title is a claim about coverage, and a reviewer reading "the four apex
  // readers" and a green tick has been told something untrue by me. Either
  // drive them or say one — so this drives all of them, and the count in the
  // title is now the count in the loop.
  //
  // FIVE, not four: the lap-3 class sweep found `weaponInHand` and
  // `refuseShroudedLoot` beyond the three the review named, so "the four apex
  // readers" had also gone stale as a description of the class.
  //
  // The probe: point the readers at a store path that does not exist and ask
  // whether a file appears. `openDynamic`'s default runs the WAL pragma and the
  // whole schema DDL, so a write-mode open CREATES the store; a read-only open
  // does not. That separates the two modes by behaviour rather than by reading
  // the constructor, which is the distinction this whole lane turns on.
  const before = process.env.WORLD_DYNAMIC_DB;
  const results = [];
  try {
    for (const [name, drive] of [
      ["holdingsFor", async (m) => {
        const { holdingsFor } = await import(`../src/world-apex.mjs?p=${m}`);
        return holdingsFor({ handle: "wright" }, null);
      }],
      ["groundWithinReach", async (m) => {
        const { groundWithinReach } = await import(`../src/world-apex.mjs?p=${m}`);
        return groundWithinReach({ standpoint: { x: 0, y: 0 } }, null);
      }],
      ["phaseAt", async (m) => {
        const { phaseAt } = await import(`../src/world-apex.mjs?p=${m}`);
        return phaseAt(null, []);
      }],
      ["portalBlockAt", async (m) => {
        const { portalBlockAt } = await import(`../src/world-apex.mjs?p=${m}`);
        return portalBlockAt(null, []);
      }],
      ["readHoldEffects", async (m) => {
        const { readHoldEffects } = await import(`../src/world-hold.mjs?p=${m}`);
        return readHoldEffects({ handles: ["wright"] });
      }],
      ["weaponInHand", async (m) => {
        const { weaponInHand } = await import(`../src/arena.mjs?p=${m}`);
        return weaponInHand(null, "wright");
      }],
      // SEVEN, not six: `callHoldTool`'s `world_holdings` branch is a reader
      // too, and it was opening the store in WRITE mode — it just had no way in
      // over HTTP, because the REST route into it was dead (#2599). Waking that
      // route without this would have made it the sixth write-mode reader, so
      // the two land together and this is the guard on the second half.
      ["callHoldTool-world_holdings", async (m) => {
        const { callHoldTool } = await import(`../src/world-hold.mjs?p=${encodeURIComponent(m)}`);
        return callHoldTool("world_holdings", { handle: "wright" }, { handles: new Set(["wright"]) });
      }],
    ]) {
      const missing = join(tmp, `no-store-${name}`, "dynamic.db");
      process.env.WORLD_DYNAMIC_DB = missing;
      let threw = null;
      try { await drive(name); } catch (e) { threw = String(e?.message ?? e).slice(0, 80); }
      results.push({ name, created: existsSync(missing), threw });
    }
  } finally {
    if (before === undefined) delete process.env.WORLD_DYNAMIC_DB;
    else process.env.WORLD_DYNAMIC_DB = before;
  }

  const creators = results.filter((r) => r.created);
  assert.equal(creators.length, 0,
    "THESE READS CREATED THE STORE — a write-mode open, which is the handle DEC-4 forbids a worker to hold: "
    + creators.map((r) => r.name).join(", "));
  const throwers = results.filter((r) => r.threw);
  assert.equal(throwers.length, 0,
    "a reader met an absent store and threw instead of answering empty: "
    + throwers.map((r) => `${r.name} (${r.threw})`).join(", "));
  assert.equal(results.length, 7, "the count in the title must be the count in the loop");
});

test("§3c readHoldEffects says UNREADABLE on an absent RECORD, not empty", async () => {
  // ⚑ THE FLIP FOUND THIS ONE GREEN. F15 made `readHoldEffects` claim
  // `readable: true` on an absent store and NOTHING reddened — the repair had
  // landed with no check behind it, which is the third time this lane has met
  // "a correction with no guard". `readable` is a claim about whether the
  // record was READ; "I read it and it is empty" is the same sentence a
  // genuinely empty store produces, and a caller cannot tell them apart.
  //
  // ── THE RECORD MOVED, THE PROMISE DID NOT (POS-153) ───────────────────────
  //
  // The holding shelf reads `acts` now, so the absent thing under test is the
  // RECORD rather than the sqlite file, and the reason says so in its own
  // words. What this leg has always been about — that `readable` discriminates
  // and is not a constant — is unchanged, and both poles are still driven.
  const prevEnv = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
  const guards = await import("../src/world2-guards.mjs");
  let undo = null;
  try {
    delete process.env.WORLD2_PG;
    delete process.env.WORLD2_PG_URL;
    const { readHoldEffects } = await import("../src/world-hold.mjs?readable");
    const absent = await readHoldEffects({ handles: ["wright"] });
    assert.equal(absent.readable, false, "an absent record is UNREADABLE, not empty");
    assert.match(String(absent.reason ?? ""), /could not be read/i, "and it must say why, in words a caller can act on");
    assert.deepEqual(absent.events, [], "an unreadable record yields no events, and says which");

    // The other pole, without which the check passes against a hardcoded false:
    // a record that IS there reads, and says so.
    process.env.WORLD2_PG = "1";
    process.env.WORLD2_PG_URL = "postgres://the-reader-override-never-dials-this";
    undo = guards.useGuardReader(async (run) => run({ query: async () => ({ rows: [] }) }));
    const { readHoldEffects: rhe2 } = await import("../src/world-hold.mjs?readable2");
    const present = await rhe2({ handles: ["wright"] });
    assert.equal(present.readable, true, "a record that answers is readable — otherwise `readable` is a constant");
  } finally {
    if (undo) undo();
    for (const [k, v] of [["WORLD2_PG", prevEnv.pg], ["WORLD2_PG_URL", prevEnv.url]])
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});
test("§3d openOauthDb's readOnly is a handle that REFUSES a write, not a flag", () => {
  // Flip F10 — make `openOauthDb` ignore readOnly and always take the DDL path —
  // left the suite GREEN, because every other leg exercises a store that is
  // perfectly writable, so nothing anywhere observed the handle's mode. § 3
  // makes the DYNAMIC store unwritable; the key store had no such leg.
  //
  // The mode is not readable off the object, so it is asked the only way it can
  // be: give each handle a write and see which one refuses.
  const path = join(tmp, "oauth-mode-probe.db");
  openOauthDb(path).close(); // the writer creates and owns the schema

  const ro = openOauthDb(path, { readOnly: true });
  assert.throws(() => ro.exec("CREATE TABLE g3_mode_probe (x)"),
    "a readOnly handle took a write — this is the sqlite handle DEC-4 forbids a worker to hold");
  // and it can still do the one thing a worker needs it for
  assert.equal(ro.prepare("SELECT count(*) AS n FROM tokens").get().n, 0,
    "and it can still do the one thing a worker needs it for — resolve a credential");
  ro.close();

  const rw = openOauthDb(path);
  rw.exec("CREATE TABLE g3_mode_probe (x)"); // the writer's handle takes it
  rw.exec("DROP TABLE g3_mode_probe");
  rw.close();
});

// ── § 4 · no write grant ────────────────────────────────────────────────────

test("§4 the pen token is in the worker's environment and not in the worker", async () => {
  // The env var IS set for this process — see `boot` — because that is the
  // real condition: workers share the writer's EnvironmentFile. So the claim is
  // not "the token is absent from the box", it is "the process dropped it".
  assert.equal(globalThis.__bootEnv.POSTMARK_PEN_TOKEN, PEN,
    "the fixture must actually hand THIS WORKER a token, or §4 tests nothing");

  // The pen's one observable door: request_residency answers not-yet-open with
  // no token. It is a POST, so the role refuses it first — which is itself the
  // proof that no request can reach the pen at all.
  const res = await call("/residency", { method: "POST", body: "{}" });
  assert.equal(res.status, 405, "the pen's own door is unreachable on a read worker");

  // ⚑ AND THE GRANT ITSELF, READ OFF THE RUNNING PROCESS. Everything above
  // this line stayed TRUE when the flip put the pen token back into the read
  // role — the 405 is §1's claim and the boot line is a sentence about the
  // role, so §4 was watching neither the token nor anything that depends on
  // it. F6 was green against a read worker holding a live pen. This is the leg
  // that reddens it.
  const rel = await (await call("/release")).json();
  assert.equal(rel.role, "read");
  assert.equal(rel.write_grant, false,
    "the worker is holding a pen token it was handed — `no write grant` is a claim about what the process HAS");
  assert.equal(rel.writes_at, WRITER);

  // And the construction, driven directly, so the decision is watched at both
  // ends rather than only where it happens to be observable.
  assert.equal(penTokenFor("read", { POSTMARK_PEN_TOKEN: PEN }), "");
  assert.equal(penTokenFor("write", { POSTMARK_PEN_TOKEN: PEN }), PEN);

  // And the boot line says so, because an operator reading journalctl over four
  // ports has no other way to tell which process can take a letter.
  assert.match(globalThis.__bootLine, /ROLE read \(sqlite read-only, no write grant/);
  assert.match(globalThis.__bootLine, new RegExp(`writes → ${WRITER.replace(/[/.]/g, "\\$&")}`));
});

// ── § 5 · the rule itself ───────────────────────────────────────────────────

test("§5 workerSafe is a method rule with three named holes, and defaults to UNSAFE", () => {
  // A door nobody has written yet must be refused by a worker until somebody
  // decides otherwise. This asserts the DIRECTION the rule fails in.
  assert.equal(workerSafe("POST", "/a-door-invented-tomorrow"), false);
  assert.equal(workerSafe("PATCH", "/a-door-invented-tomorrow"), false);
  assert.equal(workerSafe("DELETE", "/town"), false);
  assert.equal(workerSafe("GET", "/a-read-invented-tomorrow"), true);
  assert.equal(workerSafe("HEAD", "/town"), true);
  assert.equal(workerSafe("GET", "/mcp"), false);
  assert.equal(workerSafe("GET", "/oauth/authorize"), false);
  assert.equal(workerSafe("GET", "/.well-known/oauth-protected-resource"), false);
  assert.equal(workerSafe("GET", "/.well-known/openid-configuration"), false);
});
