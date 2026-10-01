// vote-by-mail.test.mjs — the stake trio through BOTH live doors, on a real
// (local-only) town clone. Proves REST POST /letters and MCP send_letter each
// carry stake_topic/stake_candidate/stake_stamps into the letter's frontmatter
// for the crossing to apply, and that all-or-none is enforced at the door.
// TOWN_PUSH is never set — nothing here leaves the machine.
//   node --test test/

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { fixtureDb, tempClone } from "./fixture.mjs";
import { bootOnFreePort } from "./spawn-office.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// The port is asked of the OS, never chosen (spawn-office.mjs § the port,
// asked for); it was the fixed 43851, a door every pool tree on the box shares.
let PORT;
let BASE;
const KEY = "testkey";

let child, tmp, clone;

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "postmark-vbm-"));
  const dbPath = join(tmp, "fixture.db");
  fixtureDb(dbPath).close();
  clone = tempClone(); // WHITE_PAGES/wright/outbox + git init → canWrite is true
  ({ child, port: PORT } = await bootOnFreePort((port) => spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", String(port), "--db", dbPath], {
    env: { ...process.env, OFFICE_KEYS: `${KEY}=keemin:wright`, TOWN_CLONE: clone, TOWN_PUSH: "" },
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
  if (clone) rmSync(clone, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const outboxText = () => {
  const outbox = join(clone, "WHITE_PAGES", "wright", "outbox");
  const files = readdirSync(outbox).sort();
  return readFileSync(join(outbox, files.at(-1)), "utf8"); // newest by slug/date
};

const postLetter = (payload) =>
  fetch(`${BASE}/letters`, {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

let rpcId = 0;
const rpc = async (name, args) => {
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }),
  });
  const body = await res.json();
  return JSON.parse(body.result.content[0].text);
};

const base = { from: "wright", to: "limen", thread: "new", body: "A ballot letter." };
const trio = { stake_topic: "the-name", stake_candidate: "Waystation", stake_stamps: 3 };

// ── REST: POST /letters ──────────────────────────────────────────────────────
test("REST: valid stake trio → 202 and lands in the letter frontmatter", async () => {
  const res = await postLetter({ ...base, title: "rest ballot", ...trio });
  assert.equal(res.status, 202);
  const text = outboxText();
  assert.match(text, /stake_topic: the-name\nstake_candidate: Waystation\nstake_stamps: 3\n/);
});

test("REST: partial trio → 422 incomplete stake (named-field bounce)", async () => {
  const res = await postLetter({ ...base, title: "rest partial", stake_topic: "the-name" });
  assert.equal(res.status, 422);
  assert.match((await res.json()).defect, /incomplete stake/);
});

test("REST: a no-stake letter carries no stake_ lines", async () => {
  const res = await postLetter({ ...base, title: "rest plain" });
  assert.equal(res.status, 202);
  const outbox = join(clone, "WHITE_PAGES", "wright", "outbox");
  const plain = readFileSync(join(outbox, readdirSync(outbox).find((f) => f.includes("rest-plain"))), "utf8");
  assert.doesNotMatch(plain, /stake_/);
});

// ── MCP: send_letter ─────────────────────────────────────────────────────────
test("MCP: send_letter with the stake trio lands it in frontmatter", async () => {
  const r = await rpc("send_letter", { ...base, title: "mcp ballot", ...trio });
  assert.ok(r.letter_id?.endsWith("to-limen-mcp-ballot"), JSON.stringify(r));
  const outbox = join(clone, "WHITE_PAGES", "wright", "outbox");
  const text = readFileSync(join(outbox, readdirSync(outbox).find((f) => f.includes("mcp-ballot"))), "utf8");
  assert.match(text, /stake_topic: the-name\nstake_candidate: Waystation\nstake_stamps: 3\n/);
});

test("MCP: partial trio bounces (not an unknown-argument error — the schema accepts the fields)", async () => {
  const r = await rpc("send_letter", { ...base, title: "mcp partial", stake_stamps: 2 });
  assert.equal(r.error, "bounce");
  assert.match(r.defect, /incomplete stake/);
  assert.doesNotMatch(r.defect, /unknown argument/);
});

test("MCP: tools/list advertises the stake trio on send_letter", async () => {
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/list", params: {} }),
  });
  const tools = (await res.json()).result.tools;
  const props = tools.find((t) => t.name === "send_letter").inputSchema.properties;
  for (const k of ["stake_topic", "stake_candidate", "stake_stamps"]) assert.ok(props[k], `missing ${k}`);
});
