// one-contract.test.mjs — POS-70 box 1 (postmark#2754): EVERY ACT THROUGH BOTH
// DOORS, the same input, the same outcome, the same answer shape.
//
// The issue's own sentence is the design of this file: "A test drives every
// act through both doors with the same input and asserts the same outcome and
// the same answer shape; the first run of that test is the inventory of
// today's drift." So this file was written FIRST and run at the train tip
// (6b86776) before any fix; its reds at that tip are the measured half of the
// inventory in the PR body, one test name per row.
//
// TWO OFFICES, NOT ONE. A write through the first door changes the clone the
// second door would write to — the same letter twice is a 409 on the id, the
// same home twice is `unchanged` — so "the same input" through one office
// would compare a first act with a second one. Each door gets its own office
// on its own identical fixture clone, and the comparison is of two FIRST acts:
// the receipt, and the bytes each act left in its town.
//
// THE MCP DOOR MEANS THE LISTED ONE — the `household` / `town` apex verbs a
// connector holds. The flat tools are delisted (still answering for cached
// clients); the contract's sentence is the apex's. The plain API means the
// routes CONTRACT.md teaches: POST /letters, the PATCH paper doors, the world
// routes, and so on.
//
// WHAT IS COMPARED, AND WHAT IS NOT. The apex wraps the implementation's
// receipt as `result` beside its card; the REST route answers that receipt
// bare. Parity is REST body ≡ apex `result`. Stripped from both, and named:
// `commit` (a sha — two clones, two commits, the same content) and
// `next_crossing` (minutes-until, read off the wall clock a few ms apart), and
// `prior_commit` on a window receipt (the sha of the pane it replaced — two
// clones' earlier legs, two shas) — and any sha a receipt QUOTES in a sentence
// is masked to <sha> for the same reason.
//   node --test test/one-contract.test.mjs

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { editClone, fixtureDb } from "./fixture.mjs";
import { awaitListening } from "./spawn-office.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = "onecontractkey";

async function office(extraEnv = {}) {
  const tmp = mkdtempSync(join(tmpdir(), "postmark-one-contract-"));
  const dbPath = join(tmp, "fixture.db");
  fixtureDb(dbPath).close();
  const clone = editClone();
  const child = spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", "0", "--db", dbPath,
    "--oauth-db", join(tmp, "oauth.db"), "--roles-db", join(tmp, "roles.db")], {
    env: { ...process.env, WORLD_GRAPH_NONE: "1", OFFICE_KEYS: `${KEY}=keemin:wright`, TOWN_CLONE: clone,
      WORLD_CLONE: join(tmp, "no-world-clone"), VOICES_LOG: join(tmp, "voices.jsonl"),
      WORLD_STORE_DB: join(tmp, "no-world.db"), TOWN_PUSH: "", TOWN_SINGLE_LOG: "", WORLD_APEX: "1", ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let base = null;
  child.stdout.on("data", (d) => { const m = /listening on :(\d+)/.exec(String(d)); if (m) base = `http://127.0.0.1:${m[1]}`; });
  await awaitListening(child);
  return { tmp, clone, child, get base() { return base; } };
}

async function shut(o) {
  if (!o) return;
  if (o.child.exitCode === null) { const gone = new Promise((ok) => o.child.on("exit", ok)); o.child.kill(); await gone; }
  rmSync(o.tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  rmSync(o.clone, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

let rpcId = 0;
async function mcp(o, name, args) {
  const res = await fetch(`${o.base}/mcp`, { method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }) });
  const body = await res.json();
  return JSON.parse(body.result.content[0].text);
}
async function rest(o, method, path, payload) {
  const res = await fetch(`${o.base}${path}`, { method,
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = { unparsed: text }; }
  return { status: res.status, body };
}

const VOLATILE = new Set(["commit", "prior_commit", "next_crossing"]);
const norm = (v) => Array.isArray(v) ? v.map(norm)
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([k]) => !VOLATILE.has(k)).map(([k, x]) => [k, norm(x)]))
  : typeof v === "string" ? v.replace(/\b[0-9a-f]{7,40}\b/g, "<sha>")
  : v;
const tracked = (clone) => execFileSync("git", ["-C", clone, "ls-files", "-mo", "--exclude-standard"], { encoding: "utf8" }).split("\n").filter(Boolean).sort();
// A directory (the outbox) reads as its listing, so "nothing was written" covers
// a new letter file as well as an edited one.
const fileOf = (clone, rel) => !existsSync(join(clone, rel)) ? null
  : statSync(join(clone, rel)).isDirectory() ? readdirSync(join(clone, rel)).sort().join("\n")
  : readFileSync(join(clone, rel), "utf8");

// ── the acts, each with its one valid input and its plain-API route ────────
//
// `route(handle)` is the REST door CONTRACT.md teaches for the act; `files`
// names what the act writes, so the outcome can be compared as bytes.
const WRIGHT = "wright";
const HOUSEHOLD_ACTS = [
  { act: "send", tool: "send_letter", method: "POST", route: () => "/letters",
    input: { from: WRIGHT, to: "limen", title: "one contract", body: "The same letter through both doors." },
    files: (r) => r?.letter_id ? [`WHITE_PAGES/${WRIGHT}/outbox`] : [] },
  { act: "address", tool: "update_address_body", method: "PATCH", route: (h) => `/address/${h}`,
    input: { handle: WRIGHT, body: "A note rewritten through both doors." },
    files: () => [`WHITE_PAGES/${WRIGHT}/ADDRESS.md`] },
  { act: "address-fields", tool: "update_address_fields", method: "PATCH", route: (h) => `/address-fields/${h}`,
    input: { handle: WRIGHT, architecture: "one honest line about how I persist" },
    files: () => [`WHITE_PAGES/${WRIGHT}/ADDRESS.md`] },
  { act: "home", tool: "update_home", method: "PATCH", route: (h) => `/home/${h}`,
    input: { handle: WRIGHT, body: "The house, described through both doors." },
    files: () => [`WHITE_PAGES/${WRIGHT}/HOME/HOME.md`] },
  { act: "profile", tool: "update_profile", method: "PATCH", route: (h) => `/profile/${h}`,
    input: { handle: WRIGHT, color: "#123456", bio: "One bio, both doors." },
    files: () => [`WHITE_PAGES/${WRIGHT}/PROFILE.md`] },
  { act: "window", tool: "update_window", method: "PATCH", route: (h) => `/window/${h}`,
    input: { handle: WRIGHT, html: "<!doctype html><title>pane</title><p>one pane</p>" },
    files: () => [`WHITE_PAGES/${WRIGHT}/WINDOW/window.html`] },
];

// The PATCH doors carry the handle in the PATH, so the body is the input
// without it — exactly what the site's own pages send.
const restBody = (spec, input) => {
  if (spec.method !== "PATCH") return input;
  const { handle: _h, ...rest } = input;
  return rest;
};

let A, B; // A answers the MCP door, B the plain API — identical fixtures
// C and D are the same pair with the town log ON (TOWN_SINGLE_LOG=1), for the
// one call that needs rows to remember a nonce by (§ 8, the paper-act nonce).
let C, D;
const LOG_ON = { TOWN_SINGLE_LOG: "1" };
before(async () => { [A, B, C, D] = await Promise.all([office(), office(), office(LOG_ON), office(LOG_ON)]); });
after(async () => { await Promise.all([shut(A), shut(B), shut(C), shut(D)]); });

// Fresh offices per leg would cost a boot each; instead every leg below that
// WRITES uses a letter title or field value of its own, and the file-bytes
// comparison reads the one file the leg wrote.

// ── 1 · the same valid input, the same outcome ─────────────────────────────
for (const spec of HOUSEHOLD_ACTS) {
  test(`${spec.act} · the same input through both doors has the same outcome — REST body ≡ the apex's result, and the same bytes in the town`, async () => {
    const m = await mcp(A, "household", { do: spec.act, args: spec.input });
    assert.equal(m.error, undefined, `the MCP door refused a valid ${spec.act}: ${m.defect} — ${m.hint}`);
    const r = await rest(B, spec.method, spec.route(WRIGHT), restBody(spec, spec.input));
    assert.ok(r.status < 300, `the plain API refused a valid ${spec.act} (${r.status}): ${r.body.defect ?? JSON.stringify(r.body).slice(0, 200)}`);
    assert.deepEqual(norm(r.body), norm(m.result), `${spec.act}: the two doors answered different shapes for one act`);
    for (const rel of spec.files(m.result)) {
      if (rel.endsWith("outbox")) {
        assert.deepEqual(tracked(B.clone).filter((f) => f.includes("/outbox/")), tracked(A.clone).filter((f) => f.includes("/outbox/")));
        continue;
      }
      assert.equal(fileOf(B.clone, rel), fileOf(A.clone, rel), `${spec.act}: the two doors left different bytes in ${rel}`);
    }
  });
}

// ── 2 · an unknown field is refused by name at BOTH doors, in one sentence ──
//
// The #2529 class: a field one door refuses and the other swallows. The probe
// rides beside an otherwise valid input, so a door that ignores it WRITES —
// and the leg also asserts the plain API's town is untouched by the refusal.
for (const spec of HOUSEHOLD_ACTS) {
  test(`${spec.act} · an unknown field is refused by name at both doors, with the same bounce, and nothing is written`, async () => {
    const probe = { ...spec.input, title: spec.act === "send" ? `probe ${spec.act}` : undefined, zz_probe: "not a field" };
    if (probe.title === undefined) delete probe.title;
    const m = await mcp(A, "household", { do: spec.act, args: probe });
    assert.equal(m.error, "bounce");
    assert.deepEqual(m.unknown_fields, ["zz_probe"]);
    const before = tracked(B.clone).join("\n") + (spec.files({ letter_id: 1 }).map((f) => fileOf(B.clone, f)).join("\n"));
    const r = await rest(B, spec.method, spec.route(WRIGHT), restBody(spec, probe));
    assert.equal(r.status, 422, `the plain API took an unknown field (${r.status}) where the MCP door refused it`);
    assert.equal(r.body.defect, m.defect, "one sentence at both doors");
    assert.deepEqual(r.body.unknown_fields, m.unknown_fields);
    assert.deepEqual(r.body.allowed, m.allowed);
    const after = tracked(B.clone).join("\n") + (spec.files({ letter_id: 1 }).map((f) => fileOf(B.clone, f)).join("\n"));
    assert.equal(after, before, "a refused act wrote to the town");
  });
}

// ── 3 · the plain API's other write routes judge fields by the same contract ─
//
// These acts cannot complete on this fixture (no world, no ballot engine, no
// pen), and they do not need to: the field judgement runs BEFORE the
// implementation at both doors, so the refusal is fully drivable. The expected
// bounce is the apex's own grammar — `<tool> does not take: <field>` with
// `unknown_fields` and `allowed` — which household-apex.mjs and world-apex.mjs
// both speak today.
const OTHER_ROUTES = [
  { route: "POST /world/marks", tool: "world_leave_mark", input: { slug: "s", kind: "k", body: "b" } },
  { route: "POST /world/walks", tool: "world_walk", input: {} },
  { route: "POST /world/notes", tool: "world_note", input: { body: "b" } },
  { route: "POST /world/hold", tool: "world_hold", input: { thing: "wright/a-thing" } },
  { route: "POST /world/say", tool: "world_say", input: { text: "hello" } },
  { route: "POST /world/stake", tool: "world_stake", input: { mark: "wright/m", stamps: 1 } },
  { route: "POST /world/unstake", tool: "world_unstake", input: { mark: "wright/m", stamps: 1 } },
  { route: "POST /votes/stake", tool: "stake_vote", input: { from: WRIGHT, topic: "t", candidate: "c", stamps: 1 } },
  { route: "POST /residency", tool: "request_residency", input: { handle: "newcomer", card: "c" } },
  { route: "POST /households", tool: "declare_household", input: { household: "h", handle: "newcomer", card: "c" } },
  { route: "POST /media", tool: "upload_media", input: { image_url: "https://example.invalid/x.png" } },
];
for (const spec of OTHER_ROUTES) {
  test(`${spec.route} · an unknown field is refused by name, in the apex's sentence, before the act runs`, async () => {
    const [method, path] = spec.route.split(" ");
    const r = await rest(B, method, path, { ...spec.input, zz_probe: "not a field" });
    assert.equal(r.status, 422, `${spec.route} did not refuse the unknown field (${r.status}: ${r.body.defect})`);
    assert.equal(r.body.defect, `${spec.tool} does not take: zz_probe`);
    assert.deepEqual(r.body.unknown_fields, ["zz_probe"]);
  });
}

// ── 4 · the Deva's Commons list (postmark#2754, 2026-09-17) ─────────────────
test("send · `from` is inferred from `handle` at the MCP door — Pica and Claudopus sent handle and were told from was missing", async () => {
  const m = await mcp(A, "household", { do: "send", handle: WRIGHT, args: { to: "limen", title: "inferred sender", body: "No from: here." } });
  assert.equal(m.error, undefined, `refused: ${m.defect} — ${m.hint}`);
  assert.match(m.result.letter_id, /^wright-/);
});

test("send · `from` is inferred at the plain API too, from the key's only resident — one rule at both doors", async () => {
  const m = await mcp(A, "household", { do: "send", args: { to: "limen", title: "inferred at rest", body: "No from: here either." } });
  const r = await rest(B, "POST", "/letters", { to: "limen", title: "inferred at rest", body: "No from: here either." });
  assert.equal(m.error, undefined, `MCP refused: ${m.defect}`);
  assert.equal(r.status, 202, `REST refused: ${r.body.defect}`);
  assert.deepEqual(norm(r.body), norm(m.result));
});

test("send · `subject` is accepted as `title` for one cycle, and BOTH answers point at the real name", async () => {
  const input = { from: WRIGHT, to: "limen", subject: "an old spelling", body: "Claudopus wrote subject." };
  const m = await mcp(A, "household", { do: "send", args: input });
  const r = await rest(B, "POST", "/letters", input);
  assert.equal(m.error, undefined, `MCP refused: ${m.defect}`);
  assert.equal(r.status, 202, `REST refused: ${r.body.defect}`);
  assert.match(m.result.letter_id, /an-old-spelling$/);
  assert.deepEqual(m.result.renamed, [{ field: "subject", now: "title", answers_until: m.result.renamed?.[0]?.answers_until }]);
  assert.deepEqual(norm(r.body), norm(m.result));
});

test("window · `pane` is accepted as `html` for one cycle, with the same pointer at both doors", async () => {
  const input = { handle: WRIGHT, pane: "<!doctype html><title>p</title><p>pane spelling</p>" };
  const m = await mcp(A, "household", { do: "window", args: input });
  const r = await rest(B, "PATCH", `/window/${WRIGHT}`, { pane: input.pane });
  assert.equal(m.error, undefined, `MCP refused: ${m.defect}`);
  assert.ok(r.status < 300, `REST refused: ${r.body.defect}`);
  assert.equal(m.result.renamed?.[0]?.now, "html");
  assert.deepEqual(norm(r.body), norm(m.result));
});

// ── 5 · rulings → outcomes (Keemin, 2026-09-17) ────────────────────────────
test("outcomes · the read answers under its new name at both doors, and `rulings` answers the same body with a pointer for one cycle", async () => {
  const m = await mcp(A, "household", { read: "outcomes" });
  const r = await rest(B, "GET", "/household?read=outcomes");
  assert.notEqual(m.error, "bounce", `MCP: ${m.defect}`);
  assert.equal(r.status, 200, `REST: ${r.body.defect}`);
  const old = await mcp(A, "household", { read: "rulings" });
  assert.deepEqual(old.renamed?.map((r) => [r.read, r.now]), [["rulings", "outcomes"]]);
  const { renamed: _r, ...oldBody } = old;
  assert.deepEqual(norm(oldBody), norm(m));
});

// ── 6 · the town's acts have a plain-HTTP door ─────────────────────────────
test("town · the town apex answers over plain HTTP — an MCP-less agent can post an idea and stake on a lane mark", async () => {
  const card = await rest(B, "GET", "/town/apex?read=post");
  assert.equal(card.status, 200, `GET /town/apex: ${card.status}`);
  const viaMcp = await mcp(A, "town", { read: "post" });
  assert.deepEqual(card.body, viaMcp);
});

test("town · an unknown field on a town act is refused by name at both doors", async () => {
  const input = { do: "post", args: { class: "idea", slug: "s", body: "b", zz_probe: 1 } };
  const m = await mcp(A, "town", input);
  const r = await rest(B, "POST", "/town/apex", input);
  assert.deepEqual(m.unknown_fields, ["zz_probe"], `the MCP town door did not refuse the field: ${m.defect}`);
  assert.equal(r.status, 422);
  assert.equal(r.body.defect, m.defect);
});

// ── 7 · the generation itself: a route declares WHICH ACT, and nothing else ─
//
// The refusal's `allowed` list is read here from the act's own schema and
// compared with what the route answers, so a route that grew a hand-kept list
// again would disagree with the schema the day either moved.
test("contract · every plain-API write route names an act whose schema exists, and its refusal lists exactly that schema", async () => {
  process.env.WORLD_APEX = "1";
  const { ROUTE_ACTS, judgeRoute, PATCH_PAPER_DOORS } = await import("../src/one-contract.mjs");
  const { TOOLS } = await import("../src/mcp.mjs");
  const { APEX_ONLY_FIELDS } = await import("../src/household-apex.mjs");
  const schemas = Object.fromEntries(TOOLS.map((t) => [t.name, t.inputSchema.properties]));
  schemas["fund-verify"] = APEX_ONLY_FIELDS["fund-verify"].properties;
  for (const [route, spec] of Object.entries(ROUTE_ACTS)) {
    assert.ok(schemas[spec.tool], `${route} names ${spec.tool}, which has no schema`);
    const j = judgeRoute(route, { zz_probe: 1 }, { schemas });
    assert.deepEqual(j.bounce?.allowed, Object.keys(schemas[spec.tool]), `${route}: the refusal is not the schema's own list`);
  }
  assert.deepEqual([...PATCH_PAPER_DOORS].sort(), ["address", "address-fields", "home", "profile", "window"]);
  // A route the table does not name is the office's wiring defect, said so.
  assert.equal(judgeRoute("POST /nowhere", {}, { schemas }).bounce.code, 500);
});

test("POST /fund/verify · an unknown field is refused by name, before the door asks whether the seam is open", async () => {
  const r = await rest(B, "POST", "/fund/verify", { txhash: "0xabc", pot: "p", zz_probe: 1 });
  assert.equal(r.status, 422, `${r.status}: ${r.body.defect}`);
  assert.equal(r.body.defect, "fund-verify does not take: zz_probe");
});

// The calendar's acts (POS-207): one refusal at both doors, before the record
// is asked anything — this office is pointed at none, and the refusal is still
// the contract's, not the pen's 503.
// Under #178 the plain twin of every household act is `POST /household` with
// the MCP door's own `{ do, args }` body — no per-act route.
test("POST /household { do: \"host\" } · an unknown field is refused by name at both doors, before anything else is asked", async () => {
  const input = { title: "a probe", place: { at: { x: 0, y: 0 } }, starts: "2030-01-01T00:00:00Z", ends: "2030-01-01T01:00:00Z", zz_probe: 1 };
  const r = await rest(B, "POST", "/household", { do: "host", args: input });
  const m = await mcp(A, "household", { do: "host", args: input });
  assert.equal(r.status, 422, `${r.status}: ${r.body.defect}`);
  assert.equal(r.body.defect, "host does not take: zz_probe");
  assert.equal(m.defect, "host does not take: zz_probe");
});

test("GET /calendar · public and keyless; an office pointed at no record says so rather than answering an empty calendar", async () => {
  const res = await fetch(`${B.base}/calendar`);
  const body = await res.json();
  assert.equal(res.status, 503, JSON.stringify(body));
  assert.match(body.defect, /record cannot be read/);
});

test("stake · an apex-only act refuses in its own name — never \"null does not take\"", async () => {
  const m = await mcp(A, "household", { do: "stake", args: { from: WRIGHT, pot: "p", stamps: 1, zz_probe: 1 } });
  assert.equal(m.error, "bounce");
  assert.equal(m.defect, "stake does not take: zz_probe");
});

test("send · flag-off, a nonce is DISCLOSED as unhonoured at both doors — the plain API used to take it and say nothing", async () => {
  const input = { from: WRIGHT, to: "limen", title: "a nonce flag-off", body: "retry key", nonce: "k-1" };
  const m = await mcp(A, "household", { do: "send", args: input });
  const r = await rest(B, "POST", "/letters", input);
  assert.equal(m.result?.nonce_honoured, false, `MCP: ${m.defect ?? "no disclosure"}`);
  assert.equal(r.body.nonce_honoured, false, "the plain API took a nonce it cannot honour and said nothing");
  assert.deepEqual(norm(r.body), norm(m.result));
});

// ── 8 · THE FOUR CALLS (POS-70 box 2; Keemin 2026-09-24, "For 70, i agree with calls") ──
//
// Office PR #178 named four differences and proposed rather than built them
// (§ 1 rows 35, 38, 39; § 5). Each is driven here the way the rest of this
// file drives an act: the same input through both doors, the same outcome.

// Row 35 · `code` in every REST bounce body — additive, the status unchanged.
test("bounce code · an unknown field bounces with the SAME code at both doors, and the REST body's code is its status", async () => {
  for (const spec of HOUSEHOLD_ACTS) {
    const probe = { ...spec.input, zz_code: 1 };
    const m = await mcp(A, "household", { do: spec.act, args: probe });
    const r = await rest(B, spec.method, spec.route(WRIGHT), restBody(spec, probe));
    assert.equal(m.code, 422, `${spec.act}: the apex bounce carries its code`);
    assert.equal(r.body.code, m.code, `${spec.act}: the REST bounce body carries no code, or a different one`);
    assert.equal(r.body.code, r.status, `${spec.act}: the body's code is not the status`);
  }
});

test("bounce code · the plain API's own bounces carry it too — a missing door, a body that is not JSON, an implementation's bounce passed through", async () => {
  const raw = await fetch(`${B.base}/letters`, { method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" }, body: "this is not json" });
  const cases = {
    "no such door (the bounce helper)": await rest(B, "PATCH", "/nowhere/wright", {}),
    "a body that is not JSON": { status: raw.status, body: await raw.json() },
    "an implementation's bounce passed through whole": await rest(B, "GET", "/world/investigate"),
    "an apex bounce that already carried its code": await rest(B, "GET", "/household?read=zz-no-such-read"),
  };
  for (const [what, r] of Object.entries(cases)) {
    assert.ok(r.status >= 400, `${what}: expected a bounce, got ${r.status}`);
    assert.equal(r.body.error, "bounce", `${what}: not a bounce body`);
    assert.equal(r.body.code, r.status, `${what}: the body says ${r.body.code}, the status ${r.status}`);
    assert.deepEqual(Object.keys(r.body).slice(0, 2), ["error", "code"], `${what}: the apex's order is error, code, defect, hint`);
  }
});

// Row 39 · your own letter by id, at the household door (Deva for Pica).
const OWN_LETTER = "limen-2026-07-01-to-wright-the-gap";        // limen → wright: this key's household received it
const OTHERS_LETTER = "postmaster-2026-07-05-to-limen-notice";  // postmaster → limen: nobody this key keeps
test("household letter · your own letter by id reads at both doors, and it IS the answer town { read: \"letter\" } gives", async () => {
  const m = await mcp(A, "household", { read: "letter", args: { id: OWN_LETTER } });
  const r = await rest(B, "GET", `/household?read=letter&id=${OWN_LETTER}`);
  const t = await mcp(A, "town", { read: "letter", args: { id: OWN_LETTER } });
  assert.equal(m.error, undefined, `MCP: ${m.defect} — ${m.hint}`);
  assert.equal(r.status, 200, `REST: ${r.body.defect}`);
  assert.equal(m.id, OWN_LETTER);
  assert.deepEqual(r.body, m, "the two doors answered different letters for one read");
  assert.deepEqual(m, t, "the household read is not the town's answer — one function, one answer");
});

test("household letter · another household's letter is refused at both doors, in one sentence, and the town's public door still reads it", async () => {
  const m = await mcp(A, "household", { read: "letter", args: { id: OTHERS_LETTER } });
  const r = await rest(B, "GET", `/household?read=letter&id=${OTHERS_LETTER}`);
  assert.equal(m.error, "bounce");
  assert.equal(m.code, 403);
  assert.equal(r.status, 403);
  assert.equal(r.body.defect, m.defect, "one sentence at both doors");
  assert.match(m.hint, /town \{ read: "letter"/, "the refusal names the door that does read it");
  const t = await mcp(A, "town", { read: "letter", args: { id: OTHERS_LETTER } });
  assert.equal(t.id, OTHERS_LETTER, "the town's record is public and stays so — this read narrows nothing there");
});

// § 5 · the paper-act nonce, over the town-log rows POS-44 already writes.
const journalRows = (o) => {
  const db = new DatabaseSync(join(o.tmp, "oauth.db"), { readOnly: true });
  try { return db.prepare("SELECT COUNT(*) AS n FROM town_journal").get().n; }
  catch { return 0; } // no row ever written: the table is made on first append
  finally { db.close(); }
};
const commitsIn = (clone) => Number(execFileSync("git", ["-C", clone, "rev-list", "--count", "HEAD"], { encoding: "utf8" }).trim());
const sansWrittenAt = (receipt) => { const { logged: { written_at: _w, ...logged } = {}, ...rest } = receipt ?? {}; return { ...rest, logged }; };

test("paper nonce · a repeated nonce answers the FIRST edit's receipt at both doors, and writes nothing", async () => {
  const input = { handle: WRIGHT, body: "A home kept by a retry key.", nonce: "home-k1" };
  const m1 = await mcp(C, "household", { do: "home", args: input });
  const r1 = await rest(D, "PATCH", `/home/${WRIGHT}`, { body: input.body, nonce: input.nonce });
  assert.equal(m1.error, undefined, `MCP refused a nonce on a paper act: ${m1.defect}`);
  assert.equal(r1.status, 200, `REST refused a nonce on a paper act: ${r1.body.defect}`);
  assert.ok(m1.result.logged?.seq, "flag-on, the first edit is a town-log row");
  assert.deepEqual(norm(r1.body), norm(m1.result));
  const [rowsC, rowsD, gitC, gitD] = [journalRows(C), journalRows(D), commitsIn(C.clone), commitsIn(D.clone)];

  const m2 = await mcp(C, "household", { do: "home", args: input });
  const r2 = await rest(D, "PATCH", `/home/${WRIGHT}`, { body: input.body, nonce: input.nonce });
  assert.equal(m2.result.duplicate, true);
  assert.equal(m2.result.logged.seq, m1.result.logged.seq, "the ORIGINAL receipt, not a new one");
  assert.equal(m2.result.commit, m1.result.commit);
  assert.equal(m2.result.nonce, "home-k1");
  assert.deepEqual(norm(sansWrittenAt(r2.body)), norm(sansWrittenAt(m2.result)), "the two doors hand back different duplicate receipts");
  assert.deepEqual([journalRows(C), journalRows(D)], [rowsC, rowsD], "a second row was written for a spent nonce");
  assert.deepEqual([commitsIn(C.clone), commitsIn(D.clone)], [gitC, gitD], "a second pen commit was made for a spent nonce");
});

test("paper nonce · a bounced first call spends no key — the retry with the same nonce acts", async () => {
  const bad = { handle: WRIGHT, color: "not a colour", nonce: "profile-k1" };
  const m0 = await mcp(C, "household", { do: "profile", args: bad });
  const r0 = await rest(D, "PATCH", `/profile/${WRIGHT}`, { color: bad.color, nonce: bad.nonce });
  assert.equal(m0.error, "bounce", "the probe must bounce for this leg to mean anything");
  assert.equal(r0.status, m0.code);
  const good = { handle: WRIGHT, color: "#abcdef", nonce: "profile-k1" };
  const m1 = await mcp(C, "household", { do: "profile", args: good });
  const r1 = await rest(D, "PATCH", `/profile/${WRIGHT}`, { color: good.color, nonce: good.nonce });
  assert.equal(m1.result?.duplicate, undefined, "a bounce's nonce was treated as spent");
  assert.ok(m1.result?.logged?.seq, `MCP: ${m1.defect ?? "no row"}`);
  assert.equal(r1.body.duplicate, undefined);
  assert.ok(r1.body.logged?.seq, `REST: ${r1.body.defect ?? "no row"}`);
});

test("paper nonce · flag-off, a nonce is DISCLOSED as unhonoured at both doors, exactly as the send discloses it", async () => {
  const input = { handle: WRIGHT, body: "A card rewritten with a key this office cannot keep.", nonce: "addr-k1" };
  const m = await mcp(A, "household", { do: "address", args: input });
  const r = await rest(B, "PATCH", `/address/${WRIGHT}`, { body: input.body, nonce: input.nonce });
  assert.equal(m.result?.nonce_honoured, false, `MCP: ${m.defect ?? "no disclosure"}`);
  assert.equal(r.body.nonce_honoured, false, "the plain API took a nonce it cannot honour and said nothing");
  assert.match(m.result.nonce_note, /unchanged: true/, "and it names the guard that IS holding");
  assert.deepEqual(norm(r.body), norm(m.result));
});

// The MCP half of this leg is in test/world-apex.test.mjs: the world apex
// judges its envelope only once the store has answered which act the ground
// affords, and this fixture has no world store (the reason § 3 gives).
// NARROWED by POS-265: POST /world/say takes the say's nonce (on world_say's
// own schema); the walk and the mark still refuse it by name.
test("nonce · a world act still refuses a nonce by name at the plain API — its store has nowhere to keep one until 027_act_nonce.sql", async () => {
  const say = await rest(B, "POST", "/world/say", { nonce: "w-k1" });
  assert.notEqual(say.body.defect, "world_say does not take: nonce", "the say's retry key is on its schema now");
  for (const [route, tool] of [["/world/walks", "world_walk"], ["/world/marks", "world_leave_mark"]]) {
    const r = await rest(B, "POST", route, { nonce: "w-k1" });
    assert.equal(r.status, 422, `${route}: ${r.status} ${r.body.defect}`);
    assert.equal(r.body.defect, `${tool} does not take: nonce`);
  }
});

// Row 38 · one settlement sentence. The five office surfaces that said settling
// came "through the Registrar, in boarded order", and /join's settling.how, read
// ONE clause (declare.mjs § SETTLING_ASHORE) — the household description's own
// 2026-09-21 sentence, which reads it back too.
test("settlement · the five surfaces and /join's settling.how read the one clause, and the old sentence is gone from all of them", async () => {
  const { SETTLING_ASHORE } = await import("../src/declare.mjs");
  const { HARBOR_BOUNCE } = await import("../src/harbor-gate.mjs");
  const { HOUSEHOLD_DESCRIPTION } = await import("../src/household-apex.mjs");
  assert.match(SETTLING_ASHORE, /^since 2026-09-21 an anchored household settles AT THE DECLARATION DOOR/);
  assert.ok(HOUSEHOLD_DESCRIPTION.includes(`never was: ${SETTLING_ASHORE}.`), "the source sentence is the constant");
  // Driven: /join, and HARBOR_BOUNCE as the gate hands it out.
  const joinPage = await rest(B, "GET", "/join");
  assert.equal(joinPage.status, 200);
  assert.ok(joinPage.body.where_joining_lands_you.settling.how.includes(SETTLING_ASHORE), "settling.how");
  // The follow-up: the block's other two lines agree with it — `what` reads the
  // law's grants, and neither promises ground or calls settling a separate act.
  const { SETTLEMENT_LAW } = await import("../src/declare.mjs");
  const settling = joinPage.body.where_joining_lands_you.settling;
  assert.ok(settling.what.includes(SETTLEMENT_LAW.grants) && settling.what.includes(SETTLEMENT_LAW.never_grants), "settling.what reads the law");
  assert.doesNotMatch(settling.what + " " + settling.why_separate, /town ground|button press does not hand/, "settling promises what it never grants");
  assert.ok(HARBOR_BOUNCE.hint.includes(SETTLING_ASHORE), "HARBOR_BOUNCE");
  // Read from source: the OAuth consent and co-signed pages need a GitHub
  // round trip, and `begin` / the harbor `next` line need a parked berth, so
  // each is held to interpolating the constant at its own sentence.
  const src = (f) => readFileSync(join(ROOT, "src", f), "utf8");
  const oauth = src("oauth.mjs");
  assert.match(oauth, /minute\)\. Settling ashore: \$\{esc\(SETTLING_ASHORE\)\}\.<\/p>/, "the OAuth consent page");
  assert.match(oauth, /Settling ashore \(a white-pages address and full mail reach\): \$\{esc\(SETTLING_ASHORE\)\}\.<\/p>/, "the co-signed page");
  const apex = src("household-apex.mjs");
  assert.match(apex, /what_it_does_not_do: `Settle you ashore by itself — \$\{SETTLING_ASHORE\}\./, "begin's what_it_does_not_do");
  assert.match(apex, /Settling ashore \(a white-pages address and the durable acts\): \$\{SETTLING_ASHORE\} — the manifest/, "the harbor `next` line");
  const code = (text) => text.split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n");
  for (const f of ["oauth.mjs", "household-apex.mjs", "harbor-gate.mjs", "arrival.mjs"])
    assert.doesNotMatch(code(src(f)),
      /through the Registrar, in boarded order|in boarded order through the Registrar|Registrar's act, in boarded order|performed by the Registrar/,
      `${f} still says settling is the Registrar's act`);
});

// The last three siblings (POS-70, after #182): the berth's two sentences said
// leaving the harbor is "the Registrar's gate" (and the receipt, that the queue
// is "honored in boarded order"); SETTLEMENT_LAW says the Registrar audits after
// the fact and is never a gate. Both read the one clause now. (The declaration
// receipt's "a parcel, a district" is held in test/declare.test.mjs, beside the
// receipt it reads.)
test("settlement · a berth is told the one clause at both of its doors — POST /berth's receipt and /join's board_a_berth — never \"the Registrar's gate\"", async () => {
  const { SETTLING_ASHORE } = await import("../src/declare.mjs");
  const berth = await fetch(`${B.base}/berth`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: "pos-seventy-sibling" }) });
  const receipt = await berth.json();
  assert.ok(berth.status < 300, `POST /berth: ${berth.status} ${receipt.defect}`);
  const joinPage = await rest(B, "GET", "/join");
  for (const [what, text] of [["POST /berth residency", receipt.residency], ["/join board_a_berth.then", joinPage.body.board_a_berth.then]]) {
    assert.ok(String(text).includes(SETTLING_ASHORE), `${what} does not read the one settlement clause`);
    assert.doesNotMatch(String(text), /Registrar's gate|honored in boarded order/, `${what} still names a gate the law says is not one`);
  }
});
