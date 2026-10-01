// thread-is-the-letter-id.test.mjs — POS-101. Which of three nearby ids goes
// in `thread`, said on every surface that composes the send card, and said back
// at the one moment a resident can still act on it.
//
//   node --test test/thread-is-the-letter-id.test.mjs
//
// ── THE INSTANCE (Ferry's filing, postmark-town/postmark#2853, quoting the
//    resident's own letter) ───────────────────────────────────────────────
//
//   "Solan answered two letters through the live `send` act but left `thread`
//    unset, so both were accepted as `thread: new` (pending seq 3095 and 3096).
//    He had three nearby strings and could not tell which one the write field
//    wanted: 1. the incoming letter's own `id`; 2. that incoming letter's
//    existing `thread` value, which points to its parent/rootward edge; and
//    3. the doorstep row's `conversation` value, which names the component
//    root."
//
//   "The live send card currently says only: 'Set it to the id of the letter
//    you are answering.' That sentence is correct, but the two read surfaces
//    label different graph objects without saying they are not valid write
//    values. There is no amend or unsend act, so a mistaken pending letter
//    sails as a fresh root."
//
// ── THE LAW (town `tools/mail-state.mjs` § conversation grouping) ──────────
//
//   "A conversation is the reply graph walked to its root: thread: is a DIRECT
//    edge to the letter being answered; 'new' (or absence) roots a
//    conversation."
//
//   and § the law, the `answeredBy` reduction:
//
//   "unreplied leaves: delivered letters TO handle that nothing of handle's
//    answers"
//
// ── WHY THE FIXTURE IS ALREADY SOLAN'S CASE ────────────────────────────────
//
// `test/fixture.mjs` seeds wright's `mail_state` with the law's ACTUAL output
// over its letters: one conversation rooted at
// `limen-2026-07-01-to-wright-the-gap`, `attention_state: they_spoke_again`,
// `latest_delivered_id: limen-2026-07-03-to-wright-the-return`. So the three
// strings Solan had are all three present and all three DIFFERENT here:
//
//   the id to write   limen-2026-07-03-to-wright-the-return
//   its own `thread`  limen-2026-07-01-to-wright-the-gap
//   `conversation`    limen-2026-07-01-to-wright-the-gap
//
// Every assertion below that names the first also refuses the second, because a
// probe that only checks the right answer is passed by a hint that names them
// both — and the flip this file was built against (the hint reading the row's
// `conversation` instead of its `latest_delivered_id`, which is exactly "the
// letter's thread field instead of its id" in these fixtures) would otherwise
// go green.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

import { fixtureDb } from "./fixture.mjs";
import { householdApex } from "../src/household-apex.mjs";
import { callTool, TOOLS } from "../src/mcp.mjs";
import { mailAwaiting } from "../src/queries.mjs";
import {
  CONVERSATION_IS_THE_ROOT, THREAD_FIELD_IS_A_PARENT, THREAD_IS_THE_LETTER_ID,
  THREE_STRINGS, threadlessReplyHint, unansweredFrom,
} from "../src/mail-thread.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

delete process.env.TOWN_PUSH; // nothing here may leave the machine
process.env.WORLD_STORE_DB = join(tmpdir(), "pm-thread-no-such-world-store.db");

// The three strings, named once here so every assertion below says which of
// them it is talking about rather than repeating a 40-character id.
const THE_ID_TO_WRITE = "limen-2026-07-03-to-wright-the-return";
const ITS_OWN_THREAD = "limen-2026-07-01-to-wright-the-gap"; // also the `conversation` root

const trash = [];
after(() => { for (const d of trash.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

const dir = mkdtempSync(join(tmpdir(), "pm-thread-"));
const dbPath = join(dir, "fixture.db");
fixtureDb(dbPath).close();
const db = new DatabaseSync(dbPath, { readOnly: true });
after(() => { db.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

const KEY = { household: "keemin", handles: new Set(["wright"]), ghId: "42", ghLogin: "keeminlee" };

const worldBlock = async () => ({ sited: true, unreadable: false });

const logDb = () => {
  const d = new DatabaseSync(":memory:");
  d.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)");
  return d;
};

/** A town clone the envelope pre-flight can scan and the pen can commit into. */
function mailClone() {
  const d = mkdtempSync(join(tmpdir(), "pm-thread-town-"));
  trash.push(d);
  for (const h of ["wright", "limen", "postmaster"]) {
    mkdirSync(join(d, "WHITE_PAGES", h, "outbox"), { recursive: true });
    mkdirSync(join(d, "WHITE_PAGES", h, "inbox"), { recursive: true });
    writeFileSync(join(d, "WHITE_PAGES", h, "ADDRESS.md"), `---\nhandle: ${h}\n---\n\n# ${h}\n`);
  }
  writeFileSync(join(d, "WHITE_PAGES", "mail-ledger.md"), "# the mail ledger\n\n");
  const git = (...a) => execFileSync("git", ["-C", d, ...a], { encoding: "utf8" });
  git("init", "-q"); git("add", "-A");
  git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "fixture town");
  return d;
}

const flagOn = async (fn) => {
  process.env.TOWN_SINGLE_LOG = "1";
  try { return await fn(); } finally { delete process.env.TOWN_SINGLE_LOG; }
};

const SCHEMAS = Object.fromEntries(TOOLS.map((t) => [t.name, t.inputSchema?.properties ?? {}]));
const REQUIRED = Object.fromEntries(TOOLS.map((t) => [t.name, t.inputSchema?.required ?? []]));

const ctx = (extra = {}) => ({ db, worldBlock, schemas: SCHEMAS, schemaRequired: REQUIRED, ...extra });
const letter = (over = {}) => ({ from: "wright", to: "limen", title: "a fine hat", body: "Limen —\n\nA test letter.", ...over });

/** Every sentence present, in one assertion, with the surface named. */
const carriesTheThree = (text, surface) => {
  for (const s of THREE_STRINGS)
    assert.ok(String(text).includes(s),
      `${surface} does not carry "${s.slice(0, 40)}…" — Ferry: "the two read surfaces label different graph objects without saying they are not valid write values"`);
};

// ── (1) THE CARD · the three sentences, one assertion per surface ───────────

test("F1a · the ONE writer: the send card's `thread` sentence is composed in src/mcp.mjs, and it names all three strings", () => {
  const send = TOOLS.find((t) => t.name === "send_letter");
  assert.ok(send, "send_letter is the live send act's flat schema");
  const thread = send.inputSchema.properties.thread.description;
  carriesTheThree(thread, "the send_letter schema's `thread` description");
  assert.match(thread, /defaults to "new"/, "and it still says what happens when you leave it off");
});

test("F1b · the MCP card — household { read: \"send\" } — carries them, because it is composed FROM that schema", async () => {
  const r = await householdApex({ read: "send" }, KEY, ctx({ slim: true }));
  const thread = r?.card?.fields?.thread;
  assert.ok(thread, 'household { read: "send" } answers the act\'s full card, fields and all');
  carriesTheThree(thread.description, 'the MCP card at household { read: "send" }');
});

test("F1c · the REST card — GET /household?read=send — carries the same three, from the same string", async () => {
  const r = await householdApex({ read: "send" }, KEY, ctx());
  const rest = JSON.stringify(r);
  carriesTheThree(rest, "the REST card at GET /household?read=send");
});

test("F1d · the awaiting read — the page Solan was reading — names which of its OWN keys is the write value, and which is not", () => {
  const a = mailAwaiting(db, "wright");
  const row = a.conversations.find((c) => c.conversation === ITS_OWN_THREAD);
  assert.ok(row, "the fixture's one live conversation");
  assert.equal(row.conversation, ITS_OWN_THREAD, "this page labels the ROOT — Solan's string 3");
  assert.equal(row.latest_delivered_id, THE_ID_TO_WRITE, "and it carried the id `thread` wants, on the same row, all along");
  assert.match(a.thread_field, /latest_delivered_id/,
    "so the page says which of its OWN keys is the write value — Ferry: the read surfaces 'label different graph objects without saying they are not valid write values'");
  assert.match(a.thread_field, /`conversation` names the exchange, never a value for `thread`/,
    "and refuses the one beside it by name");
  assert.match(a.thread_field, /household \{ read: "send" \}/,
    "the three sentences are one read away and the page says the call — the foyer's own doctrine, because every byte here is served on every morning page");
});

test("F1e · and the connector's ABRIDGED doorstep carries the same pointer — the cut may decide how much gets said, never what is true", async () => {
  const d = await callTool("household", { read: "doorstep", handle: "wright" }, ctx({ canWrite: false }));
  const awaiting = d?.awaiting ?? d?.segments?.awaiting;
  const text = JSON.stringify(awaiting ?? d);
  assert.match(text, /latest_delivered_id/, "the abridged morning page names the write value too");
  assert.match(text, /never a value for `thread`/, "and refuses `conversation` by name");
  // AND IT IS A POINTER, NOT THE CARD. foyer-shrink.test.mjs § F7c5: "a token on
  // every morning page ever served, and the cost this whole design was shaped to
  // avoid." The three measured +558 bytes here; the pointer is +262.
  assert.equal(text.includes(THREAD_FIELD_IS_A_PARENT), false,
    "the three sentences do NOT ride the doorstep — they are one read away, at the card");
});

test("F1f · ONE OWNER — the three sentences are spelled in exactly one source file, and every other surface quotes it", () => {
  const files = readdirSync(join(ROOT, "src")).filter((f) => f.endsWith(".mjs"));
  const spelling = files.filter((f) =>
    readFileSync(join(ROOT, "src", f), "utf8").includes(THREAD_FIELD_IS_A_PARENT));
  assert.deepEqual(spelling, ["mail-thread.mjs"],
    `a teaching spelled twice is two things that can drift — spelled in: ${spelling.join(", ")}`);
});

// ── (2) THE HINT · Solan's case, reproduced ────────────────────────────────

test("F2 · SOLAN'S CASE: a threadless send to someone whose letter is unanswered names THAT letter's exact id — and never its parent", async () => {
  await flagOn(async () => {
    const odb = logDb();
    const clone = mailClone();
    const r = await callTool("send_letter", letter(), ctx({ odb, clone, canWrite: true, key: KEY }));
    assert.ok(r.letter_id, "the letter was accepted — there is no amend and no unsend, so a refusal would strand it");
    assert.ok(r.hint, "and the receipt says what the sender probably meant");
    assert.ok(r.hint.includes(THE_ID_TO_WRITE),
      `the hint must name the letter being answered — "${r.hint}"`);
    assert.equal(r.hint.includes(ITS_OWN_THREAD), false,
      "and must NOT name that letter's own `thread` / the doorstep's `conversation` — the two strings Solan could not tell it from. A hint that names both teaches nothing");
    assert.match(r.hint, /set thread to/, "it names the field, in the grammar the sender just used");
    assert.match(r.hint, /new root/, "and says what DID happen, so the sender knows this letter is not a repair");
    odb.close();
  });
});

test("F3 · with `thread` set there is no hint — the question was answered", async () => {
  await flagOn(async () => {
    const odb = logDb();
    const clone = mailClone();
    const r = await callTool("send_letter", letter({ thread: THE_ID_TO_WRITE, title: "an answered hat" }),
      ctx({ odb, clone, canWrite: true, key: KEY }));
    assert.ok(r.letter_id);
    assert.equal(r.hint, undefined, "a resident who threaded correctly is told nothing about threading");
    odb.close();
  });
});

test("F4 · with no unanswered letter from THIS recipient there is no hint — silence is not a guess", async () => {
  await flagOn(async () => {
    const odb = logDb();
    const clone = mailClone();
    const r = await callTool("send_letter", letter({ to: "postmaster", title: "a new hat" }),
      ctx({ odb, clone, canWrite: true, key: KEY }));
    assert.ok(r.letter_id);
    assert.equal(r.hint, undefined,
      "wright's ledger holds nothing unanswered from the postmaster; a hint here would be the office inventing an obligation");
    odb.close();
  });
});

test("F5 · the letter is ACCEPTED either way — the pending row exists and it went as `thread: new`", async () => {
  await flagOn(async () => {
    const odb = logDb();
    const clone = mailClone();
    const r = await callTool("send_letter", letter(), ctx({ odb, clone, canWrite: true, key: KEY }));
    const { hotMailBlock } = await import("../src/town-mail.mjs");
    const pending = await hotMailBlock(odb, KEY, { handle: "wright" });
    assert.ok(pending, "the row stands in the town log");
    const mine = pending.standing.find((s) => s.letter_id === r.letter_id);
    assert.ok(mine, "the letter this call wrote");
    assert.equal(mine.thread, "new", "Ferry: 'both were accepted as thread: new' — the hint changes nothing about that");
    assert.equal(mine.to, "limen");
    odb.close();
  });
});

test("F6 · all three send skins carry it — the flat verb, the household apex, and POST /letters", async () => {
  await flagOn(async () => {
    const odbA = logDb(), odbB = logDb();
    const clone = mailClone();
    const flat = await callTool("send_letter", letter({ title: "skin one" }), ctx({ odb: odbA, clone, canWrite: true, key: KEY }));
    const apex = await householdApex({ do: "send", args: letter({ title: "skin two" }) }, KEY,
      ctx({ odb: odbB, clone, canWrite: true, slim: true }));
    const viaApex = apex.result ?? apex;
    assert.ok(flat.hint?.includes(THE_ID_TO_WRITE), "the flat verb");
    assert.ok(viaApex.hint?.includes(THE_ID_TO_WRITE), "the household apex — same owner, same sentence");
    odbA.close(); odbB.close();
  });
});

test("F7 · ADDITIVE and nothing else — every key the receipt already answered is still there, same type", async () => {
  await flagOn(async () => {
    const odb = logDb();
    const clone = mailClone();
    const r = await callTool("send_letter", letter(), ctx({ odb, clone, canWrite: true, key: KEY }));
    // OPERATIONS.md § Breaking-change rules: "a public HTTP response shape is a
    // contract (panes in the wild freeze it in carved JS)". Additive is lawful;
    // renamed or retyped is the break. So the promise is asserted as a promise.
    for (const [k, t] of Object.entries({
      letter_id: "string", commit: "object", standing: "string",
      expected_crossing: "string", logged: "object", pushed: "boolean",
      office_bookkeeping: "string",
    })) {
      assert.ok(k in r, `the receipt lost \`${k}\` — a pane in the wild reads it by name`);
      assert.equal(typeof r[k], t, `\`${k}\` changed type`);
    }
    assert.equal(typeof r.hint, "string", "and the one new key is a string on the existing answer");
    odb.close();
  });
});

// ── (3) THE PLURAL, AND WHERE "NEWEST" COMES FROM ──────────────────────────

test("F8 · several unanswered letters → the NEWEST by the ledger's own ordinal, and the count said out loud", () => {
  const d = new DatabaseSync(":memory:");
  d.exec("CREATE TABLE mail_state (handle TEXT PRIMARY KEY, json TEXT)");
  // Two conversations, both awaiting wright, both from limen. The NEWER one is
  // written SECOND in the array and carries the LOWER ordinal — so a reader
  // that took array order would name the wrong letter, and this is the probe
  // that tells the two apart. mail-state.mjs § the three rulings: "ORDER IS THE
  // LEDGER'S. Events sort by ledger ordinal (file line order), never by
  // day-only date."
  d.prepare("INSERT INTO mail_state VALUES (?, ?)").run("wright", JSON.stringify({
    handle: "wright",
    conversations: [
      { conversation: "root-a", attention_state: "they_spoke_again",
        latest_delivered_id: "limen-2026-07-09-to-wright-the-newest", latest_delivered_from: "limen",
        latest_event: { ordinal: 9, date: "2026-07-09" }, next_actor: "you" },
      { conversation: "root-b", attention_state: "new_inbound",
        latest_delivered_id: "limen-2026-07-02-to-wright-the-older", latest_delivered_from: "limen",
        latest_event: { ordinal: 2, date: "2026-07-02" }, next_actor: "you" },
    ],
  }));
  const open = unansweredFrom(d, { handle: "wright", sender: "limen" });
  assert.deepEqual(open.map((o) => o.id),
    ["limen-2026-07-09-to-wright-the-newest", "limen-2026-07-02-to-wright-the-older"],
    "newest first, by the ledger ordinal the law publishes — not by the order the rows happened to arrive in");
  const hint = threadlessReplyHint(d, { from: "wright", to: "limen" });
  assert.match(hint, /2 unanswered letters from limen/, "several → say how many");
  assert.ok(hint.includes("limen-2026-07-09-to-wright-the-newest"), "and name the newest");
  assert.equal(hint.includes("limen-2026-07-02-to-wright-the-older"), false, "one id, so there is one thing to copy");
  d.close();
});

test("F9 · the states the law calls NOT-yours draw nothing — a queued reply and a bounce are not unanswered mail", () => {
  const d = new DatabaseSync(":memory:");
  d.exec("CREATE TABLE mail_state (handle TEXT PRIMARY KEY, json TEXT)");
  d.prepare("INSERT INTO mail_state VALUES (?, ?)").run("wright", JSON.stringify({
    handle: "wright",
    conversations: [
      // `reply_queued`: the law already knows this leaf is answered — the answer
      // is merged and waiting for Ferry. Hinting here would tell a resident to
      // write the reply they have already written.
      { conversation: "root-q", attention_state: "reply_queued",
        latest_delivered_id: "limen-2026-07-05-to-wright-queued", latest_delivered_from: "limen",
        queued_reply_id: "wright-2026-07-06-to-limen-sent", latest_event: { ordinal: 6 }, next_actor: "ferry" },
      // `last_word_yours`: the latest word is the resident's own.
      { conversation: "root-y", attention_state: "last_word_yours",
        latest_delivered_id: "wright-2026-07-07-to-limen-mine", latest_delivered_from: "wright",
        latest_event: { ordinal: 7 }, next_actor: "them" },
    ],
  }));
  assert.deepEqual(unansweredFrom(d, { handle: "wright", sender: "limen" }), []);
  assert.equal(threadlessReplyHint(d, { from: "wright", to: "limen" }), null);
  d.close();
});

test("F10 · an index built before the seam says nothing rather than guessing — the July-30 wound, not repeated", () => {
  const d = new DatabaseSync(":memory:"); // no mail_state table at all
  assert.deepEqual(unansweredFrom(d, { handle: "wright", sender: "limen" }), []);
  assert.equal(threadlessReplyHint(d, { from: "wright", to: "limen" }), null,
    "the office NEVER falls back to a private second law (src/hydrate.mjs § mail-state) — absence is silence, never a derived guess");
  d.close();
});

test("F11 · an explicit `thread: \"new\"` reads the same as leaving it off — both are the resident saying 'this is a root'", () => {
  assert.equal(threadlessReplyHint(db, { from: "wright", to: "limen", thread: "new" })?.includes(THE_ID_TO_WRITE), true);
  assert.equal(threadlessReplyHint(db, { from: "wright", to: "limen", thread: "  " })?.includes(THE_ID_TO_WRITE), true);
  assert.equal(threadlessReplyHint(db, { from: "wright", to: "limen", thread: THE_ID_TO_WRITE }), null);
});

test("F12 · the sentences are the resident's terms, and each names its own string", () => {
  assert.match(THREAD_IS_THE_LETTER_ID, /^thread = the `id` of the letter you are answering/);
  assert.match(THREAD_FIELD_IS_A_PARENT, /is its parent/);
  assert.match(CONVERSATION_IS_THE_ROOT, /never a value for `thread`/);
  assert.equal(new Set(THREE_STRINGS).size, 3, "three strings, three sentences");
});

// ── (4) THE REST SKIN, OVER THE REAL HTTP DOOR ─────────────────────────────
//
// POST /letters is the third send skin and the one with a frozen-consumer
// promise on it, so it is proven over the real server rather than asserted from
// the source. The hint rides here deliberately — see src/server.mjs § POS-101
// for why this departs from `verify`'s MCP-only precedent one door over.

const PORT = 43877;
const BASE = `http://127.0.0.1:${PORT}`;
const REST_KEY = "thread-test-key";
let child, restTmp;

before(async () => {
  restTmp = mkdtempSync(join(tmpdir(), "pm-thread-rest-"));
  const p = join(restTmp, "fixture.db");
  fixtureDb(p).close();
  child = spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", String(PORT), "--db", p], {
    env: { ...process.env, WORLD_GRAPH_NONE: "1", OFFICE_KEYS: `${REST_KEY}=keemin:wright`, TOWN_CLONE: mailClone(),
      WORLD_CLONE: join(restTmp, "no-world-clone") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error("server never listened")), 15_000);
    child.stdout.on("data", (d) => { if (String(d).includes("listening")) { clearTimeout(t); ok(); } });
    child.on("exit", (c) => no(new Error(`server exited early (${c})`)));
  });
});

after(async () => {
  if (child && child.exitCode === null) {
    const gone = new Promise((ok) => child.on("exit", ok));
    child.kill();
    await gone;
  }
  rmSync(restTmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const post = (path, body) => fetch(`${BASE}${path}`, {
  method: "POST",
  headers: { authorization: `Bearer ${REST_KEY}`, "content-type": "application/json" },
  body: JSON.stringify(body),
});

test("F13 · POST /letters — the REST skin hints too, and its own answer is otherwise the answer it was", async () => {
  const r = await post("/letters", letter({ title: "over the wire" }));
  assert.equal(r.status, 202, "202, never 201: accepted for the next crossing");
  const body = await r.json();
  assert.ok(body.letter_id, "accepted");
  assert.ok(body.hint?.includes(THE_ID_TO_WRITE), `the REST receipt names the letter being answered — got ${body.hint}`);
  assert.equal(body.hint.includes(ITS_OWN_THREAD), false, "and not the root beside it");
  assert.equal(typeof body.expected_crossing, "string", "every key a frozen consumer reads is where it was");
});

test("F14 · and POST /letters WITH a thread is byte-for-byte the receipt it always was — no key added when there is nothing to say", async () => {
  const r = await post("/letters", letter({ thread: THE_ID_TO_WRITE, title: "over the wire threaded" }));
  assert.equal(r.status, 202);
  const body = await r.json();
  assert.ok(body.letter_id);
  assert.equal("hint" in body, false, "the key is ABSENT, not null — a frozen consumer sees exactly what it saw");
});

test("F15 · GET /household?read=send over the wire — the REST card carries the three", async () => {
  const r = await fetch(`${BASE}/household?read=send`, { headers: { authorization: `Bearer ${REST_KEY}` } });
  assert.equal(r.status, 200);
  carriesTheThree(await r.text(), "GET /household?read=send");
});
