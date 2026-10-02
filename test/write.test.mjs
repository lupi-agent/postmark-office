// write.test.mjs — the write spine: every bounce, then the happy path
// against a throwaway git clone. TOWN_PUSH is never set here — nothing the
// test does can leave the machine.
//   node --test test/

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fixtureDb, tempClone, fixtureKey } from "./fixture.mjs";
import { enqueueLetter, nextCrossing } from "../src/write.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";

delete process.env.TOWN_PUSH; // belt and braces: the spine must stay local

const db = fixtureDb();
// The doors below run in this process and read their town index from a store
// seeded from this fixture (POS-268, office-under-test.mjs).
const IX = await indexStore(db);
const IX_RESTORE = await IX.useInProcess();
test.after(async () => { await IX_RESTORE(); await IX.stop(); });
const ok = { from: "wright", to: "limen", title: "a fine hat", thread: "new", body: "Limen —\n\nA test letter." };
const bounce = (payload, key = fixtureKey) => {
  try { enqueueLetter(payload, key, db, "unused"); }
  catch (e) { return e; }
  assert.fail("expected a bounce");
};

test("incomplete envelope → 422", () => {
  assert.equal(bounce({ ...ok, title: "" }).code, 422);
  assert.equal(bounce({ ...ok, body: undefined }).code, 422);
});

test("a key may act from: only its own residents → 403", () => {
  const e = bounce({ ...ok, from: "limen" });
  assert.equal(e.code, 403);
  assert.match(e.hint, /wright/);
});

test("unknown recipient → 422", () => {
  assert.equal(bounce({ ...ok, to: "nobody" }).code, 422);
});

test("thread must be 'new' or a known letter id → 422", () => {
  assert.equal(bounce({ ...ok, thread: "no-such-letter" }).code, 422);
  // a real letter id is accepted (proven by not bouncing at the thread check:
  // it proceeds to the write phase, exercised in the happy path below)
});

// `thread:` went optional at the crossing on 2026-07-27 (tools/envelope.mjs).
// The door has to default it the same way, or the office keeps rejecting the
// exact letters the ferry now accepts — the inconsistency the change ends.
test("thread is optional at the door and defaults to new", () => {
  const clone = tempClone();
  try {
    const { thread, ...threadless } = ok;
    assert.equal(enqueueLetter(threadless, fixtureKey, db, clone).pushed, false);
    const outbox = join(clone, "WHITE_PAGES", "wright", "outbox");
    const text = readFileSync(join(outbox, readdirSync(outbox)[0]), "utf8");
    assert.match(text, /thread: new\n/);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("size courtesy → 413", () => {
  assert.equal(bounce({ ...ok, body: "x".repeat(100_001) }).code, 413);
});

test("nextCrossing is always a future 00:00Z or 12:00Z", () => {
  const c = new Date(nextCrossing(new Date("2026-07-07T13:30:00Z")));
  assert.equal(c.toISOString(), "2026-07-08T00:00:00.000Z");
  const c2 = new Date(nextCrossing(new Date("2026-07-07T03:00:00Z")));
  assert.equal(c2.toISOString(), "2026-07-07T12:00:00.000Z");
});

test("happy path: letter file + bot commit on the clone, pushed:false", () => {
  const clone = tempClone();
  try {
    const r = enqueueLetter(ok, fixtureKey, db, clone);
    assert.match(r.letter_id, /^wright-\d{4}-\d{2}-\d{2}-to-limen-a-fine-hat$/);
    assert.equal(r.pushed, false);
    assert.ok(new Date(r.expected_crossing) > new Date());

    const outbox = join(clone, "WHITE_PAGES", "wright", "outbox");
    const files = readdirSync(outbox);
    assert.equal(files.length, 1);
    const text = readFileSync(join(outbox, files[0]), "utf8");
    assert.match(text, /^---\nid: wright-/);
    assert.match(text, /thread: new\n/);
    assert.match(text, /A test letter\./);

    const log = execFileSync("git", ["-C", clone, "log", "-1", "--format=%H %an %s"], { encoding: "utf8" }).trim();
    assert.ok(log.startsWith(r.commit));
    assert.match(log, /postmark-office\[bot\]/);
    assert.match(log, /key household keemin/);

    // same slug, same day → 409 (the file already exists)
    assert.throws(() => enqueueLetter(ok, fixtureKey, db, clone), (e) => e.code === 409);
  } finally {
    rmSync(clone, { recursive: true, force: true });
    assert.equal(existsSync(clone), false);
  }
});

// ── vote-by-mail: the optional stake trio ───────────────────────────────────
const stake = { stake_topic: "the-name", stake_candidate: "Waystation", stake_stamps: 3 };

test("stake trio is all-or-none → 422 incomplete stake", () => {
  for (const partial of [
    { stake_topic: "the-name" },
    { stake_candidate: "Waystation" },
    { stake_stamps: 3 },
    { stake_topic: "the-name", stake_candidate: "Waystation" }, // stamps missing
    { stake_topic: "the-name", stake_stamps: 3 },               // candidate missing
  ]) {
    const e = bounce({ ...ok, ...partial });
    assert.equal(e.code, 422);
    assert.match(e.defect, /incomplete stake/);
  }
});

test("stake shape bounces: bad topic slug, non-positive / non-integer stamps → 422", () => {
  assert.match(bounce({ ...ok, ...stake, stake_topic: "The Name" }).defect, /not a ballot slug/);
  assert.match(bounce({ ...ok, ...stake, stake_topic: "-bad-" }).defect, /not a ballot slug/);
  assert.match(bounce({ ...ok, ...stake, stake_stamps: 0 }).defect, /positive whole number/);
  assert.match(bounce({ ...ok, ...stake, stake_stamps: -2 }).defect, /positive whole number/);
  assert.match(bounce({ ...ok, ...stake, stake_stamps: 1.5 }).defect, /positive whole number/);
  assert.match(bounce({ ...ok, ...stake, stake_stamps: "abc" }).defect, /positive whole number/);
  assert.match(bounce({ ...ok, ...stake, stake_candidate: "  " }).defect, /must be a name/);
});

test("a no-stake letter is byte-identical to today (no stake lines in frontmatter)", () => {
  const clone = tempClone();
  try {
    enqueueLetter(ok, fixtureKey, db, clone);
    const outbox = join(clone, "WHITE_PAGES", "wright", "outbox");
    const text = readFileSync(join(outbox, readdirSync(outbox)[0]), "utf8");
    // exact frontmatter block — the five canonical lines, then close, nothing else
    assert.match(text, /^---\nid: wright-\d{4}-\d{2}-\d{2}-to-limen-a-fine-hat\nfrom: wright\nto: limen\ndate: \d{4}-\d{2}-\d{2}\nthread: new\n---\n\n/);
    assert.doesNotMatch(text, /stake_/);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("valid trio lands stake_topic/candidate/stamps in frontmatter, after thread:", () => {
  const clone = tempClone();
  try {
    const r = enqueueLetter({ ...ok, title: "my ballot", ...stake, stake_stamps: "3" }, fixtureKey, db, clone);
    assert.ok(r.letter_id.endsWith("to-limen-my-ballot"));
    const outbox = join(clone, "WHITE_PAGES", "wright", "outbox");
    const text = readFileSync(join(outbox, readdirSync(outbox)[0]), "utf8");
    // the trio sits directly after thread:, count coerced to a bare integer
    assert.match(text, /thread: new\nstake_topic: the-name\nstake_candidate: Waystation\nstake_stamps: 3\n---\n/);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});
