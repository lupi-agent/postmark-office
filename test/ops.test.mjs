// ops.test.mjs — the principal's desk: isPrincipal gate, the /me principal bit,
// giftViaOffice mint mechanics, and the HTTP wall (non-principal → 403).
//   node --test
// Builds a real git town-in-a-bottle with the town's OWN stamp tools copied
// from the office's town clone (same live-import contract the votes tests use).
// TOWN_PUSH is never set — nothing here can leave the machine.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { giftViaOffice, isPrincipal } from "../src/ops.mjs";
import { identityOf } from "../src/queries.mjs";
import { fixtureDb } from "./fixture.mjs";
import { bootOnFreePort } from "./spawn-office.mjs";

delete process.env.TOWN_PUSH; // belt and braces: the mint must stay local

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const TOWN_TOOLS = resolve(ROOT, "town-clone", "tools");
const TOOL_FILES = ["stamp-mint.mjs", "stamp-verify.mjs"];
const PRINCIPAL_ID = "67605380"; // keemin (github-ids.json) — the live pin

const D = (date, id, from, to) => `- ${date} · ${id} · ${from} → ${to} · thread: new`;

// A caught-up town: two resident rooms (finn, a normal resident; postmaster, a
// declared meep) and a founded, fully-minted stamp-ledger — the settled tail a
// gift needs.
function giftClone() {
  const dir = mkdtempSync(join(tmpdir(), "office-ops-"));
  mkdirSync(join(dir, "tools"), { recursive: true });
  mkdirSync(join(dir, "WHITE_PAGES", "finn"), { recursive: true });
  mkdirSync(join(dir, "WHITE_PAGES", "postmaster"), { recursive: true });
  for (const f of TOOL_FILES) copyFileSync(join(TOWN_TOOLS, f), join(dir, "tools", f));

  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  writeFileSync(join(dir, "tools", "stamp-pubkey.pem"), publicKey.export({ type: "spki", format: "pem" }));
  const keyFile = join(dir, "stamp-key.pem");
  writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }));
  writeFileSync(join(dir, "tools", "github-ids.json"),
    JSON.stringify({ finn: { login: "hills", id: 74506478 } }));

  const lines = [];
  for (let i = 1; i <= 3; i++) lines.push(D("2026-06-12", `f-${i}`, "finn", `x-${i}`)); // finn sends → mints finn
  for (let i = 1; i <= 3; i++) lines.push(D("2026-06-13", `y-${i}`, `y-${i}`, "finn")); // finn receives → mints finn
  writeFileSync(join(dir, "WHITE_PAGES", "mail-ledger.md"), `# ledger\n\n${lines.join("\n")}\n`);

  const mint = (...a) => execFileSync(process.execPath, [join(dir, "tools", "stamp-mint.mjs"), ...a, "--key", keyFile, "--repo", dir], { encoding: "utf8" });
  mint("--append");
  // postmaster is a meep from 2026-06-20 (the production stamps-v2 shape)
  mint("--declare-rules", "stamps-v2", "--meeps", "postmaster", "--date", "2026-06-20");

  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("init", "-q"); git("add", "-A");
  git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "fixture town");

  process.env.STAMP_KEY = keyFile;
  delete process.env.TOWN_PUSH;
  return dir;
}

// the principal's own key (an OAuth sign-in carries the verified GitHub id)
const principalKey = { household: "keemin", handles: new Set(["wright"]), ghId: 67605380, ghLogin: "keeminlee", keyKind: "oauth" };
const strangerKey = { household: "someone", handles: new Set(["finn"]), ghId: 999999, ghLogin: "someone", keyKind: "oauth" };
const staticKey = { household: "shell", handles: new Set(["finn"]) }; // no ghId

const bounceOf = async (fn) => { try { await fn(); } catch (e) { return e; } assert.fail("expected a bounce"); };

// ── the principal gate ───────────────────────────────────────────────────────

test("isPrincipal: only the pinned GitHub id passes; static keys never do", () => {
  assert.equal(isPrincipal(principalKey, PRINCIPAL_ID), true);
  assert.equal(isPrincipal(strangerKey, PRINCIPAL_ID), false, "a different verified id is not the principal");
  assert.equal(isPrincipal(staticKey, PRINCIPAL_ID), false, "a static key has no verified id — never principal");
  assert.equal(isPrincipal(principalKey, undefined), false, "no PRINCIPAL_GH_ID configured → nobody is principal");
  assert.equal(isPrincipal(null, PRINCIPAL_ID), false);
});

test("/me carries principal: true only for the principal's session", () => {
  const prev = process.env.PRINCIPAL_GH_ID;
  process.env.PRINCIPAL_GH_ID = PRINCIPAL_ID;
  try {
    assert.equal(identityOf(principalKey).principal, true);
    assert.equal(identityOf(strangerKey).principal, false);
    assert.equal(identityOf(staticKey).principal, false);
  } finally { if (prev === undefined) delete process.env.PRINCIPAL_GH_ID; else process.env.PRINCIPAL_GH_ID = prev; }
});

// ── the gift mint mechanics (giftViaOffice → gift-exec → the town's CLI) ──────

test("giftViaOffice: a valid gift mints the exact line + returns the new balance; the ledger verifies", async () => {
  const clone = giftClone();
  try {
    const r = await giftViaOffice(clone, { handle: "finn", amount: 20, slug: "door-held-open" }, principalKey);
    assert.match(r.line, /^- \d{4}-\d{2}-\d{2} · MINT → finn · 20 · for: gift:door-held-open · by: keemin · sig: \S+$/,
      "the signed line is the exact gift grammar");
    assert.equal(typeof r.balance, "number");
    assert.ok(r.balance >= 20, "the recipient's balance includes the gift");
    assert.ok(r.commit, "the gift is a pen commit");
    // the town's own verifier accepts the sealed ledger
    const out = execFileSync(process.execPath, [join(clone, "tools", "stamp-verify.mjs"), "--repo", clone], { encoding: "utf8" });
    assert.ok(out.includes("all green"), "stamp-verify: all green");
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("giftViaOffice: a meep recipient is refused (the CLI's law, passed through as 422)", async () => {
  const clone = giftClone();
  try {
    const e = await bounceOf(() => giftViaOffice(clone, { handle: "postmaster", amount: 5, slug: "for-ferry" }, principalKey));
    assert.equal(e.code, 422);
    assert.match(e.defect, /meep/i);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("giftViaOffice: an unknown recipient is refused 422 (a gift needs a resident)", async () => {
  const clone = giftClone();
  try {
    const e = await bounceOf(() => giftViaOffice(clone, { handle: "nobody-here", amount: 5, slug: "hello" }, principalKey));
    assert.equal(e.code, 422);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("giftViaOffice: a non-kebab slug is refused 422 before it ever reaches the mint", async () => {
  const clone = giftClone();
  try {
    const e = await bounceOf(() => giftViaOffice(clone, { handle: "finn", amount: 5, slug: "Not_Kebab" }, principalKey));
    assert.equal(e.code, 422);
    assert.match(e.defect, /kebab/i);
    const e2 = await bounceOf(() => giftViaOffice(clone, { handle: "finn", amount: 0, slug: "zero" }, principalKey));
    assert.equal(e2.code, 422);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

// ── the HTTP wall: a non-principal key can never reach the mint ───────────────

// The port is asked of the OS, never chosen (spawn-office.mjs § the port,
// asked for); it was the fixed 43878, a door every pool tree on the box shares.
let PORT;
let BASE;
let child, tmp;

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "postmark-ops-srv-"));
  const dbPath = join(tmp, "fixture.db");
  fixtureDb(dbPath).close();
  ({ child, port: PORT } = await bootOnFreePort((port) => spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", String(port), "--db", dbPath], {
    // a static key (no ghId → never principal) + the principal pin + no clone
    env: { ...process.env, WORLD_GRAPH_NONE: "1", OFFICE_KEYS: "shellkey=keemin:wright", PRINCIPAL_GH_ID: PRINCIPAL_ID, TOWN_CLONE: join(tmp, "no-clone"), TOWN_PUSH: "" },
    stdio: ["ignore", "pipe", "pipe"],
  })));
  BASE = `http://127.0.0.1:${PORT}`;
});

after(async () => {
  if (child && child.exitCode === null) { const gone = new Promise((ok) => child.on("exit", ok)); child.kill(); await gone; }
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const postGift = (key) => fetch(`${BASE}/ops/gift`, {
  method: "POST",
  headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
  body: JSON.stringify({ handle: "wright", amount: 5, slug: "nice-try" }),
});

test("POST /ops/gift: a static (non-principal) key is refused 403 — the office is the wall", async () => {
  const res = await postGift("shellkey");
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.match(body.defect, /principal/i);
});

test("POST /ops/gift: no key at all is 401 (the write tier needs a credential)", async () => {
  const res = await postGift(null);
  assert.equal(res.status, 401);
});
