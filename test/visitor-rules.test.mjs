// visitor-rules.test.mjs — a berth reads the town's rules for visitors before
// its first say lands (POS-300).
//
// The falsifiers, each able to fail:
//   - a fresh berth's first say returns the rules and writes nothing: no voice
//     in the room, no line in the voices log, and no acknowledgement on its row;
//   - after `rules_read: true`, the same say lands, and the row records it once;
//   - a berth that acknowledged once is never gated again, across a restart of
//     the office on the same paperwork;
//   - a resident (anyone with an address) is never shown the gate (here at the
//     gate itself; spoken, in world-apex.test.mjs § berth);
//   - GET /berth reads the rules keyless, before any sign-in.
//
// A spawned office on its own oauth.db and voices log, the berth door's own
// idiom (server.test.mjs § POST /berth).
//
//   node --test test/visitor-rules.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { fixtureDb } from "./fixture.mjs";
import { VISITOR_RULES, visitorRulesGate, useRulesRecorder, RULES_FIRST } from "../src/visitor-rules.mjs";
import { WORLD_TOOLS } from "../src/world.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = "residentkey";
const dir = mkdtempSync(join(tmpdir(), "postmark-visitor-rules-"));
const dbPath = join(dir, "fixture.db");
fixtureDb(dbPath).close();
const OAUTH = join(dir, "oauth.db");
const VOICES = join(dir, "voices.jsonl");

let child = null;
async function startOffice() {
  child = spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", "0", "--db", dbPath,
    "--oauth-db", OAUTH, "--roles-db", join(dir, "roles.db")], {
    env: { ...process.env, OFFICE_KEYS: `${KEY}=keemin:wright`, TOWN_CLONE: join(dir, "no-clone"), WORLD_CLONE: join(dir, "no-world-clone"), VOICES_LOG: VOICES, TOWN_PUSH: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const port = await new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error("visitor-rules office never listened")), 10_000);
    child.stdout.on("data", (d) => {
      const m = /listening on :(\d+)/.exec(String(d));
      if (m) { clearTimeout(t); ok(m[1]); }
    });
    child.on("exit", (c) => no(new Error(`visitor-rules office exited early (${c})`)));
  });
  return `http://127.0.0.1:${port}`;
}
async function stopOffice() {
  if (child && child.exitCode === null) { const gone = new Promise((ok) => child.on("exit", ok)); child.kill(); await gone; }
  child = null;
}
after(async () => {
  await stopOffice();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const say = (base, key, body) => fetch(`${base}/world/say`, {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify(body),
});
const rulesReadAt = (slug) => {
  const db = new DatabaseSync(OAUTH, { readOnly: true });
  try { return db.prepare("SELECT rules_read_at FROM berths WHERE slug = ?").get(slug)?.rules_read_at ?? null; }
  finally { db.close(); }
};
const voicesLog = () => (existsSync(VOICES) ? readFileSync(VOICES, "utf8") : "");

test("the berth's arc: rules first, nothing written; acknowledged once; never gated again, across a restart", async () => {
  let base = await startOffice();

  // GET /berth: the rules, keyless, before any sign-in — the one constant.
  const pub = await fetch(`${base}/berth`);
  assert.equal(pub.status, 200);
  assert.deepEqual((await pub.json()).visitor_rules, VISITOR_RULES);

  const minted = await fetch(`${base}/berth`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: "lantern-visitor" }) });
  assert.equal(minted.status, 201);
  const b = await minted.json();
  assert.deepEqual(b.visitor_rules, VISITOR_RULES, "the mint shows the rules too");

  // The first say: refused, the rules in the answer, and nothing written.
  const words = "come try our feedback hotline";
  const first = await say(base, b.key, { text: words });
  assert.equal(first.status, 403);
  const refused = await first.json();
  assert.equal(refused.defect, RULES_FIRST.defect);
  assert.deepEqual(refused.visitor_rules, VISITOR_RULES);
  assert.ok(!voicesLog().includes(words), "a refused say must not reach the voices log");
  const room = await (await say(base, b.key, {})).json();
  assert.ok(!JSON.stringify(room).includes(words), "a refused say must not be heard in the room");
  assert.equal(rulesReadAt("lantern-visitor"), null, "a refusal records no acknowledgement");

  // Listening never needed the rules (the empty say above answered the room).
  assert.equal(room.error, undefined, JSON.stringify(room).slice(0, 200));

  // The acknowledgement: the same say, with rules_read, lands.
  const hello = "hello, is this the quay?";
  const acked = await say(base, b.key, { text: hello, rules_read: true });
  assert.equal(acked.status, 200, JSON.stringify(await acked.clone().json()).slice(0, 300));
  assert.equal((await acked.json()).spoke, true);
  const at = rulesReadAt("lantern-visitor");
  assert.ok(Number.isInteger(at) && at > 0, `the row records when: ${at}`);

  // A second acknowledgement keeps the first one's time: the gate lets an
  // acknowledged berth straight through, so it never reaches the row again
  // (the row's own once-clause is held in berth.test.mjs). The say itself may
  // meet the voice's per-speaker limiter; that is not the gate.
  await new Promise((ok) => setTimeout(ok, 1100));
  const again = await (await say(base, b.key, { text: "a second hello", rules_read: true })).json();
  assert.notEqual(again.defect, RULES_FIRST.defect);
  assert.equal(rulesReadAt("lantern-visitor"), at, "recorded once");

  // Across a restart on the same paperwork: no gate, no rules_read needed.
  await stopOffice();
  base = await startOffice();
  // The voice's per-speaker limiter (one say every 15 s) is rebuilt from the
  // voices log at boot, so it is waited out here; it is not the gate.
  await new Promise((ok) => setTimeout(ok, 15_100));
  const later = await say(base, b.key, { text: "back again after the restart" });
  const laterBody = await later.json();
  assert.equal(later.status, 200, JSON.stringify(laterBody).slice(0, 300));
  assert.equal(laterBody.spoke, true);
  assert.equal(laterBody.visitor_rules, undefined);

  // A second, fresh berth is gated on its own: the acknowledgement is per berth.
  const other = await (await fetch(`${base}/berth`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: "second-visitor" }) })).json();
  assert.equal((await say(base, other.key, { text: "hi" })).status, 403);

  // A resident is never shown the gate: proven where a resident can speak (this
  // office has no world to stand a resident in) — world-apex.test.mjs § berth.
  await stopOffice();
});

test("the gate reads the berth key alone: a resident key, acknowledged or not, is never refused", async () => {
  const resident = { household: "house-a", handles: new Set(["alpha"]) };
  assert.equal(await visitorRulesGate(resident, { text: "hi" }), null);
  assert.equal(await visitorRulesGate(resident, { text: "hi", rules_read: true }), null);
  assert.equal(await visitorRulesGate({ berth: true, slug: "x", rulesRead: true }, { text: "hi" }), null);
  const refused = await visitorRulesGate({ berth: true, slug: "x", rulesRead: false }, { text: "hi" });
  assert.equal(refused.code, 403);
  assert.deepEqual(refused.visitor_rules, VISITOR_RULES);
  assert.equal(await visitorRulesGate({ berth: true, slug: "x" }, {}, { speaking: false }), null, "listening is never gated");
});

test("an acknowledgement that cannot be recorded refuses the say rather than letting it through", async () => {
  useRulesRecorder(null);
  const r = await visitorRulesGate({ berth: true, slug: "x" }, { text: "hi", rules_read: true });
  assert.equal(r.code, 503);
  const seen = [];
  useRulesRecorder(async (slug) => { seen.push(slug); });
  assert.equal(await visitorRulesGate({ berth: "harbor-house", slug: "harbor-house" }, { text: "hi", rules_read: true }), null);
  assert.deepEqual(seen, ["harbor-house"], "an upgraded berth (a harbor household) acknowledges under its berth slug");
  useRulesRecorder(null);
});

test("rules_read is on world_say's own schema: no new verb", () => {
  const sayTool = WORLD_TOOLS.find((t) => t.name === "world_say");
  assert.equal(sayTool.inputSchema.properties.rules_read?.type, "boolean");
});
