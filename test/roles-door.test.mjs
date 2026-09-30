// roles-door.test.mjs — the role gate over the REAL HTTP door.
//
// test/roles.test.mjs proves the gate's logic. This file proves the WIRING,
// which is a different claim and needs its own receipt: a gate that is correct
// and never called is a gate that does nothing, and the module test cannot tell
// those apart. Everything here goes through `fetch` against a spawned
// `src/server.mjs`.
//
// The proof door is `/metrics/mail` — chosen as the most boring credentialed-
// or-not read the office has. Which doors are gated FOR REAL is the founder's
// call; this file only demonstrates that one wiring behaves.
//
//   node --test test/roles-door.test.mjs

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { fixtureDb } from "./fixture.mjs";
import { openRolesDb, grantRole, revokeRole } from "../src/roles.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = "roles-door-test-key";
const HOUSEHOLD = "keemin";
const GH_ID = 583231;            // the pinned account id the static key carries

/** One office, one registry, one flag state. Returns a stop() and a call(). */
async function office({ port, gates }) {
  const tmp = mkdtempSync(join(tmpdir(), "postmark-office-roles-"));
  const dbPath = join(tmp, "fixture.db");
  fixtureDb(dbPath).close();
  const rolesPath = join(tmp, "roles.db");
  openRolesDb(rolesPath).close(); // exists and empty — nobody holds anything yet

  const child = spawn(process.execPath, [
    join(ROOT, "src", "server.mjs"),
    "--port", String(port),
    "--db", dbPath,
    "--roles-db", rolesPath,
  ], {
    env: {
      ...process.env,
      // #<gh_id> pins the static key to an immutable account id — required to
      // hold a role, ignored by everything else.
      OFFICE_KEYS: `${KEY}=${HOUSEHOLD}#${GH_ID}:wright`,
      ...(gates ? { OFFICE_ROLE_GATES: "1" } : {}),
      TOWN_CLONE: join(tmp, "no-clone-here"),
      WORLD_CLONE: join(tmp, "no-world-clone"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error("server never listened")), 15_000);
    child.stdout.on("data", (d) => { if (String(d).includes("listening")) { clearTimeout(t); ok(); } });
    child.on("exit", (c) => no(new Error(`server exited early (${c})`)));
  });

  const base = `http://127.0.0.1:${port}`;
  return {
    rolesPath,
    signedIn: () => fetch(`${base}/metrics/mail`, { headers: { authorization: `Bearer ${KEY}` } }),
    anonymous: () => fetch(`${base}/metrics/mail`),
    /** The SAME read through its other call site: the MCP tool the town apex funnels into. */
    viaMcp: async () => {
      const r = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "read_metrics", arguments: {} } }),
      });
      const env = await r.json();
      const text = env?.result?.content?.[0]?.text;
      try { return JSON.parse(text); } catch { return env; }
    },
    grant: async () => { const r = openRolesDb(rolesPath); await grantRole(r, { subject: GH_ID, actor: "door-test", login: HOUSEHOLD }); r.close(); },
    revoke: async () => { const r = openRolesDb(rolesPath); await revokeRole(r, { subject: GH_ID, actor: "door-test" }); r.close(); },
    async stop() {
      if (child.exitCode === null) { const gone = new Promise((ok) => child.on("exit", ok)); child.kill(); await gone; }
      rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}

// ── FLAG OFF: the default, and every office today ───────────────────────────

let open_;
before(async () => { open_ = await office({ port: 43871, gates: false }); });
after(async () => { await open_?.stop(); });

test('FLAG OFF — "absolutely nothing changes for any caller until the founder designates real gated surfaces"', async () => {
  // Nobody holds the role. Both callers must be served anyway.
  const signedIn = await open_.signedIn();
  assert.equal(signedIn.status, 200, "a signed-in caller holding NO role is served exactly as before");
  const anon = await open_.anonymous();
  assert.equal(anon.status, 200, "and so is an anonymous one — this read was public and stays public");

  const body = await signedIn.json();
  assert.ok(body && typeof body === "object" && !body.error,
    "the response is the metrics payload, not a bounce");
  assert.ok("totals" in body || "days" in body,
    `flag off must serve the real read; got keys ${Object.keys(body ?? {}).join(",")}`);
});

// ── FLAG ON: the mechanism, demonstrated ───────────────────────────────────

test("FLAG ON — the door actually consults the registry (grant passes, revoke refuses, anonymous is told to sign in)", async () => {
  const gated = await office({ port: 43872, gates: true });
  try {
    // 1. ungranted, signed in -> 403 naming the role
    const refused = await gated.signedIn();
    assert.equal(refused.status, 403, "an ungranted household is refused at the door");
    const rb = await refused.json();
    assert.equal(rb.error, "bounce");
    assert.match(rb.defect, /subscriber/, "the refusal names the role the door wants");
    assert.match(rb.hint, /operator/i, "and tells the caller who can change it");

    // 2. anonymous -> 401, a DIFFERENT answer from the 403 above
    const anon = await gated.anonymous();
    assert.equal(anon.status, 401, "no key at all is an authentication answer, not a standing one");
    assert.notEqual((await anon.json()).defect, rb.defect,
      "the two refusals must not wear the same sentence");

    // 3. grant -> served. No restart: the CLI writes the same file the live
    //    handle reads, which is what makes hand-keeping workable at all.
    await gated.grant();
    const passed = await gated.signedIn();
    assert.equal(passed.status, 200, "a granted household passes the gate — with no office restart");
    assert.ok(!(await passed.json()).error);

    // 4. revoke -> refused again, live
    await gated.revoke();
    const after = await gated.signedIn();
    assert.equal(after.status, 403, "a revoke takes effect at the door, live");
  } finally {
    await gated.stop();
  }
});

test("A GATED SURFACE IS GATED AT EVERY CALL SITE — the MCP door serves the same read and must refuse alike", async () => {
  const gated = await office({ port: 43874, gates: true });
  try {
    // Ungated at REST but open at MCP would be a decorative gate: the office
    // would report itself closed while the same numbers walked out the other
    // door. `/metrics/mail` looked like one door and is two call sites.
    const refusedRest = await gated.signedIn();
    assert.equal(refusedRest.status, 403, "REST refuses an ungranted household");

    const refusedMcp = await gated.viaMcp();
    assert.equal(refusedMcp.error, "bounce",
      "and so must MCP — the same read through its other call site");
    assert.match(refusedMcp.defect, /subscriber/, "naming the same role");
    assert.ok(!("days" in refusedMcp) && !("totals" in refusedMcp),
      "the refusal must not carry the payload it was refusing");

    await gated.grant();
    const passedMcp = await gated.viaMcp();
    assert.ok(!passedMcp.error, "a granted household passes at the MCP door too");
    assert.ok("totals" in passedMcp || "days" in passedMcp,
      `the granted MCP call returns the real read; got keys ${Object.keys(passedMcp ?? {}).join(",")}`);
  } finally { await gated.stop(); }
});

test("FLAG OFF — the MCP door is untouched as well", async () => {
  const r = await open_.viaMcp();
  assert.ok(!r.error, "flag off: the MCP read answers exactly as before");
  assert.ok("totals" in r || "days" in r);
});

test('AMBIGUITY #4, RULED: "a household that exists only as an env string cannot hold a role"', async () => {
  const tmp = mkdtempSync(join(tmpdir(), "postmark-office-unpinned-"));
  const dbPath = join(tmp, "fixture.db");
  fixtureDb(dbPath).close();
  const rolesPath = join(tmp, "roles.db");
  // Grant to the household NAME, the way a pre-rekey operator might have.
  // Nothing about that row can ever be reached, because names are not subjects.
  const seed = openRolesDb(rolesPath);
  try { await grantRole(seed, { subject: GH_ID, actor: "seed", login: HOUSEHOLD }); } finally { seed.close(); }

  const child = spawn(process.execPath, [
    join(ROOT, "src", "server.mjs"),
    "--port", "43875", "--db", dbPath, "--roles-db", rolesPath,
  ], {
    env: {
      ...process.env,
      // NO #<gh_id> — a static key with no verified identity behind it.
      OFFICE_KEYS: `${KEY}=${HOUSEHOLD}:wright`,
      OFFICE_ROLE_GATES: "1",
      TOWN_CLONE: join(tmp, "no-clone-here"),
      WORLD_CLONE: join(tmp, "no-world-clone"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await new Promise((ok, no) => {
      const t = setTimeout(() => no(new Error("server never listened")), 15_000);
      child.stdout.on("data", (d) => { if (String(d).includes("listening")) { clearTimeout(t); ok(); } });
      child.on("exit", (c) => no(new Error(`server exited early (${c})`)));
    });
    const r = await fetch("http://127.0.0.1:43875/metrics/mail", { headers: { authorization: `Bearer ${KEY}` } });
    assert.equal(r.status, 401,
      "an unpinned static key holds no role even though a row exists for the household it names");
    const b = await r.json();
    assert.match(b.hint, /static office key with no id/,
      "and the refusal names that case specifically, because only an operator can fix it");
    assert.notEqual(r.status, 403,
      "it must NOT read as a standing judgement — nothing about this caller's standing was checked");
  } finally {
    if (child.exitCode === null) { const gone = new Promise((ok) => child.on("exit", ok)); child.kill(); await gone; }
    rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("FLAG ON but registry missing — the door says so, and does not pretend it is a judgement about the caller", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "postmark-office-noroles-"));
  const dbPath = join(tmp, "fixture.db");
  fixtureDb(dbPath).close();
  // Point --roles-db at a path inside a directory that does not exist, so the
  // open throws and the office boots with rdb = null.
  const child = spawn(process.execPath, [
    join(ROOT, "src", "server.mjs"),
    "--port", "43873", "--db", dbPath,
    "--roles-db", join(tmp, "nope", "roles.db"),
  ], {
    env: {
      ...process.env,
      // Pinned, so the caller HAS a subject — otherwise the no-subject 401
      // would fire first and this test would never reach the 503 it exists for.
      OFFICE_KEYS: `${KEY}=${HOUSEHOLD}#${GH_ID}:wright`,
      OFFICE_ROLE_GATES: "1",
      TOWN_CLONE: join(tmp, "no-clone-here"),
      WORLD_CLONE: join(tmp, "no-world-clone"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await new Promise((ok, no) => {
      const t = setTimeout(() => no(new Error("server never listened")), 15_000);
      child.stdout.on("data", (d) => { if (String(d).includes("listening")) { clearTimeout(t); ok(); } });
      child.on("exit", (c) => no(new Error(`server exited early (${c})`)));
    });
    // THE OFFICE STILL BOOTS. A registry it cannot read must not take the town down.
    const r = await fetch("http://127.0.0.1:43873/metrics/mail", { headers: { authorization: `Bearer ${KEY}` } });
    assert.equal(r.status, 503, "fail closed — an unreadable registry must never become a free door");
    const b = await r.json();
    assert.match(b.defect, /could not be read/);
    assert.match(b.hint, /NOT a statement about your standing/,
      "the caller must be told this is the office's fault, not their standing");
  } finally {
    if (child.exitCode === null) { const gone = new Promise((ok) => child.on("exit", ok)); child.kill(); await gone; }
    rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
