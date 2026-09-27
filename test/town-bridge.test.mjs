// town-bridge.test.mjs — POS-44 wave 4: the ferry bridge, the parity of the
// two skins' hot tense, and the consent door's freeze gate.
//
//   node --test test/town-bridge.test.mjs
//
// Every falsifier here QUOTES the law it asserts, verbatim, from the surface
// that owns it. A test that paraphrases a law is a test of the paraphrase.
//
// The one thing this file exists to prove is that the town log now has a LIVE
// CONSUMER. Waves 1-3 each built a drain half and left it uncalled outside a
// test; a suite that only kept testing those halves would go on being green
// while the record never moved.

import "./helpers/drain-pen.mjs"; // #2040: fixtures get a real ledger pen
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { execFileSync, spawn } from "node:child_process";
import {
  existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { fixtureDb } from "./fixture.mjs";
import { runTownDrain, townLockHeld, TOWN_DOORS, drainLine } from "../src/town-bridge.mjs";
import {
  appendTownJournal, ensureTownJournal, pendingRows, townDrainCursor,
  TOWN_CLASSES, TOWN_DRAIN_CURSOR,
} from "../src/town-journal.mjs";
import { openOauthDb } from "../src/oauth.mjs";
import { PAPER_ACTS } from "../src/town-updates.mjs";
import { MAIL_ACT, MAIL_DOOR } from "../src/town-mail.mjs";
import { letterDate, outboxRelPath } from "../src/write.mjs";
import { declareStanceViaOffice } from "../src/world-stance.mjs";
import { worldFreezeBounce } from "../src/freeze.mjs";
import { TOOLS } from "../src/mcp.mjs";
import { withRecordFrom } from "./registry-pool-stub.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

delete process.env.TOWN_PUSH; // belt and braces: nothing here may leave the machine

/**
 * A source file as flowing prose, so a quoted law can be matched against the
 * comment that states it.
 *
 * The laws below are quoted VERBATIM from the modules that own them, and those
 * modules wrap their comments at 78 columns behind `//` and ` * ` markers — so
 * a raw substring search would fail on the line break rather than on the law
 * having changed, which is the worst kind of red. Strip the markers, collapse
 * the whitespace, and the sentence is either still there or it is not.
 */
const prose = (rel) => readFileSync(join(ROOT, rel), "utf8")
  .replace(/^\s*(\/\/|\*)/gm, " ")
  .replace(/\s+/g, " ");

/** …and the law itself, collapsed the same way, so the two are comparable. */
const says = (rel, law, why) => assert.ok(prose(rel).includes(law.replace(/\s+/g, " ")), why);

// ── THE LAWS THIS FILE ASSERTS, quoted from the surfaces that own them ──────

// src/town-drain.mjs § writeTownDrain, on why the cursor moves last. This is
// the ordering the bridge is built around and the one it could most easily get
// wrong, because getting it wrong is invisible until a crash.
const CURSOR_LAST_LAW =
  "The ferry commits and pushes first; a cursor moved before the record is durable is the one ordering that can lose a household";

// src/town-journal.mjs § why it is its own table — the founder's ruling the
// two-log split was made on, and the reason the invoker refuses a class it has
// no replay for instead of skipping past it.
const ONE_LOG_ONE_CONSUMER_LAW = "the-atomic-drain's law is one log, one consumer";

// src/doorstep-bundle.mjs § the doorstep's mail block — the sentence that makes
// the hot tense a property of the town rather than of your client. It was
// written for `your_pending_letters` and it is exactly as true of
// `your_pending_edits`, which is what made the missing half a defect rather
// than a gap.
//
// THE LAW MOVED WITH ITS BLOCK, 2026-08-25. It lived in src/server.mjs while
// that file carried its own copy of the garnish sequence; the bundle refactor
// gave the three doorstep doors ONE implementation, so the block — and its law
// — now live in doorstep-bundle.mjs. The assertion follows the block rather
// than the filename, which is the whole point of quoting a law at the surface
// that owns it: if this ever fails, either the law was deleted or the block
// moved again, and both are things a reviewer must be told about.
const BOTH_SKINS_LAW =
  "a disclosure that depended on which skin you read from would make the tense a property of your client rather than of the town";

// ── fixtures ────────────────────────────────────────────────────────────────

const db = fixtureDb();

/**
 * A log in the shape the LIVE office actually has it: openOauthDb's own five
 * tables and nothing else.
 *
 * This is deliberately NOT the hand-built `:memory:` db the wave 1-3 fixtures
 * use, which create `meta` themselves. That convenience is what hid the wave-4
 * bug — see F6.
 *
 * IT LIVES OUTSIDE THE CLONE, in its own directory, and that is load-bearing
 * for F3 rather than tidiness: a db file inside the town clone is picked up by
 * `git add -A`, and its bytes change every time the cursor moves — so the
 * byte-identical assertion would fail on the LOG rather than on the record, and
 * fail every time, for a reason that has nothing to do with the drain. On the
 * box these are two different trees anyway (/srv/postmark-office vs the clone).
 */
const odbHomes = [];
function liveShapeOdb() {
  const dir = mkdtempSync(join(tmpdir(), "pm-odb-home-"));
  odbHomes.push(dir);
  return openOauthDb(join(dir, "oauth.db"));
}
const dropOdbHomes = () => { for (const d of odbHomes.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 5 }); };

/** A town clone with the rooms the doors write into, under git so the pen can commit. */
function townClone({ handles = ["wright", "limen"] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "pm-bridge-"));
  for (const h of handles) {
    mkdirSync(join(dir, "WHITE_PAGES", h, "outbox"), { recursive: true });
    mkdirSync(join(dir, "WHITE_PAGES", h, "inbox"), { recursive: true });
    mkdirSync(join(dir, "WHITE_PAGES", h, "HOME"), { recursive: true });
    writeFileSync(join(dir, "WHITE_PAGES", h, "ADDRESS.md"), `---\nhandle: ${h}\ngithub: gh-${h}\nsince: 2026-01-01\n---\n\n# ${h}\n`);
  }
  mkdirSync(join(dir, "tools"), { recursive: true });
  writeFileSync(join(dir, "tools", "households.json"), JSON.stringify({ schema_version: 1, households: {} }, null, 2) + "\n");
  writeFileSync(join(dir, "WHITE_PAGES", "mail-ledger.md"), "# the mail ledger\n\n- 2026-07-01 · a-line · someone → someone\n");
  writeFileSync(join(dir, "WHITE_PAGES", "stamp-ledger.md"), "# the stamp ledger\n\n- 2026-08-01 · registry: someone = hh:elsewhere\n");
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "fixture town");
  return dir;
}

const key = { household: "keemin", handles: new Set(["wright"]), ghId: "42", ghLogin: "keeminlee" };

/** The three classes, one row each, in the order a crossing would find them. */
function seedThreeClasses(o) {
  const join_ = appendTownJournal(o, {
    cls: "join", act: "declare-household", household: "newcomers", handle: "newcomer",
    ghId: "777", ghLogin: "newcomer-gh",
    payload: { household: "Newcomers", card: "A newcomer's card." },
  });
  const update = appendTownJournal(o, {
    cls: "update", act: "home", household: "keemin", handle: "wright",
    ghId: "42", ghLogin: "keeminlee",
    payload: { args: { handle: "wright", body: "A home written by the drain, not the door." } },
  });
  return { join_, update };
}

/** A letter row carrying the pen's own computed identity, exactly as logLetter writes it. */
// `date` DEFAULTS TO THE DOOR'S OWN ANSWER, not to a literal. It used to be
// pinned at "2026-08-24" and that pin decayed the moment the calendar moved:
// `validateLetter` dates a letter from the live clock in the town's timezone, so
// the row this seeded disclosed an AUGUST path while the door wrote today's
// file. Every test here survived that except the one that exercises the drain's
// resume check, which looked for the August path, missed, replayed the letter
// and got a 409 back instead of `already: true`. Green on 2026-08-24, red every
// day since. `letterDate()` is the door's own derivation, exported so this
// fixture can ASK rather than re-spell — the same rule `enqueueLetter` already
// states about the path ("two spellings of it would be two things that can
// drift"). Pass an explicit date only to test a date, never to name today.
function seedLetter(o, { from = "wright", to = "limen", title = "a fine hat", date = letterDate(), slug = "a-fine-hat" } = {}) {
  const id = `${from}-${date}-to-${to}-${slug}`;
  return appendTownJournal(o, {
    cls: "letter", act: MAIL_ACT, household: "keemin", handle: from,
    ghId: "42", ghLogin: "keeminlee",
    payload: {
      args: { from, to, title, thread: "new", body: `${to} —\n\nA letter the drain will materialize.` },
      id, file: outboxRelPath(from, date, to, slug),
    },
  });
}

const outboxFiles = (clone, h) => {
  const d = join(clone, "WHITE_PAGES", h, "outbox");
  return existsSync(d) ? readdirSync(d).sort() : [];
};
const inboxFiles = (clone, h) => {
  const d = join(clone, "WHITE_PAGES", h, "inbox");
  return existsSync(d) ? readdirSync(d).sort() : [];
};
const ledgerOf = (clone) => readFileSync(join(clone, "WHITE_PAGES", "mail-ledger.md"), "utf8");
/** The whole working tree as one hash — the only honest way to say "byte-identical". */
const treeHash = (clone) => {
  execFileSync("git", ["-C", clone, "add", "-A"], { encoding: "utf8" });
  return execFileSync("git", ["-C", clone, "write-tree"], { encoding: "utf8" }).trim();
};

// ASYNC-AWARE SINCE POS-158. `return fn()` handed back a promise and the
// `finally` then cleared the flag while the work was still running — a teardown
// racing the thing it tears down, which fails somewhere else entirely.
const flagOn = async (fn) => {
  process.env.TOWN_SINGLE_LOG = "1";
  try { return await fn(); } finally { delete process.env.TOWN_SINGLE_LOG; }
};

// Every run in this file is "under the lock" unless a falsifier says otherwise:
// the guard is proven on its own below, and threading a real flock through
// every other test would be asserting the platform in twelve places.
const HELD = () => true;
const silent = () => {};
// POINTED AT THE RECORD, AND AWAITED (POS-158). A crossing reads the town's
// registry from the store and writes its membership rows there, so the helper
// seeds the store from whatever registry the clone already holds — the same
// fixture these tests were already writing — and awaits the drain. Without it
// every crossing here would answer "the record is unreachable" and defer every
// row, which is correct behaviour answering the wrong question.
const run = (o, over = {}) => withRecordFrom(over.clone, () => runTownDrain(o, { db, doors: TOWN_DOORS, lockHeld: HELD, log: silent, ...over }));

// ═══════════════════════════════════════════════════════════════════════════
// F0 · THE DRAIN SPEAKS THE TOWN'S CLOCK — found live 2026-08-30 (the gift
// blackout): the 00:00Z crossing stamped registry lines with the UTC day
// (tomorrow, in town time) while the same crossing's mints carried the town
// day, and the forward-dated gate then refused every town-dated writer until
// midnight ET. The drain's default date must be TOWN_TZ's day, like every
// other dated writer in this repo.
// ═══════════════════════════════════════════════════════════════════════════

test("F0 · AT THE BOUNDARY INSTANT the drain stamps the TOWN day, never the wire's", async () => {
  const o = liveShapeOdb();
  try {
    await flagOn(async () => {
      // 2026-08-31T00:22Z is 8:22 PM EDT on 08-30 — the exact instant the live
      // bug fired. The UTC derivation this falsifier retired said 2026-08-31.
      const r = await run(o, { clone: "unused-no-rows", now: Date.UTC(2026, 7, 31, 0, 22) });
      assert.equal(r.ran, true);
      assert.equal(r.drained, 0, "an empty log drains nothing — the date is the whole assertion");
      assert.equal(r.date, "2026-08-30", "the town day, from TOWN_TZ");
      assert.notEqual(r.date, "2026-08-31", "…never the UTC day that armed the gift blackout");
    });
  } finally { o.close?.(); }
});

// ═══════════════════════════════════════════════════════════════════════════
// F1 · THE BRIDGE DRAINS ALL THREE CLASSES — the town log gets a live consumer
// ═══════════════════════════════════════════════════════════════════════════

test("F1 · THE LIVE CONSUMER: one call settles a join, a paper act and a letter", async () => {
  const clone = townClone();
  const o = liveShapeOdb();
  try {
    await flagOn(async () => {
      seedThreeClasses(o);
      seedLetter(o);
      const head = pendingRows(o).at(-1).seq;

      const r = await run(o, { clone, date: "2026-08-24" });

      assert.equal(r.ran, true);
      assert.equal(r.refused, undefined);
      assert.deepEqual(r.counts, { join: 1, update: 1, letter: 1 },
        "all three classes wave 1-3 built are drained by one caller — that is what wave 4 IS");

      // the JOIN reached the record: the pen lane's own three files
      assert.ok(existsSync(join(clone, "WHITE_PAGES", "newcomer", "ADDRESS.md")),
        "a join row becomes a white-pages address");
      assert.deepEqual(r.settled, ["newcomer"]);
      assert.match(r.commit, /^[0-9a-f]{40}$/, "the join files are the bridge's own bytes, so the bridge commits them");

      // the PAPER ACT reached the record, through the door itself
      const home = readFileSync(join(clone, "WHITE_PAGES", "wright", "HOME", "HOME.md"), "utf8");
      assert.match(home, /A home written by the drain, not the door\./,
        "the drain's output is the door's output because it IS the door");
      assert.equal(r.updates.length, 1);
      assert.equal(r.updates[0].skipped, undefined);

      // the LETTER reached its OUTBOX — and stopped there
      assert.equal(outboxFiles(clone, "wright").length, 1, "a letter row becomes an outbox file");
      assert.equal(r.letters[0].skipped, undefined);

      // and the cursor moved to the head of what was drained
      assert.equal(r.head, head);
      assert.equal(townDrainCursor(o), head);
      assert.deepEqual(pendingRows(o), [], "nothing is left pending");
    });
  } finally { o.close(); dropOdbHomes(); rmSync(clone, { recursive: true, force: true, maxRetries: 5 }); }
});

test("F1b · THE DRAIN DOES NOT DELIVER — the invoker stops exactly where replayLetter does", async () => {
  const clone = townClone();
  const o = liveShapeOdb();
  try {
    await flagOn(async () => {
      const before = ledgerOf(clone);
      seedLetter(o);
      await run(o, { clone, date: "2026-08-24" });

      assert.equal(outboxFiles(clone, "wright").length, 1, "the outbox: written");
      assert.deepEqual(inboxFiles(clone, "limen"), [],
        "the inbox: UNTOUCHED — delivery is the ferry's alone, and the ferry runs after this in the same chain");
      assert.equal(ledgerOf(clone), before,
        "the ledger: byte-for-byte unchanged — it IS the ferry's idempotency key, and a drain that wrote one line would be writing the ferry's memory");
    });
  } finally { o.close(); dropOdbHomes(); rmSync(clone, { recursive: true, force: true, maxRetries: 5 }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// F2 · FLAG-OFF IS A NO-OP THAT SAYS SO
// ═══════════════════════════════════════════════════════════════════════════

test("F2 · FLAG-OFF: rows in the table, and the bridge writes nothing and names the flag", async () => {
  const clone = townClone();
  const o = liveShapeOdb();
  try {
    delete process.env.TOWN_SINGLE_LOG;
    seedThreeClasses(o);
    seedLetter(o);
    const before = treeHash(clone);

    const lines = [];
    const r = await run(o, { clone, log: (l) => lines.push(l) });

    assert.equal(r.ran, false);
    assert.equal(r.drained, 0);
    assert.match(r.skipped, /TOWN_SINGLE_LOG is off/,
      "a step that printed nothing would be indistinguishable from a step that silently failed to run");
    assert.equal(treeHash(clone), before, "not one byte of the record moved");
    assert.equal(townDrainCursor(o), 0, "and the cursor did not move either — the rows are still there for the day the flag flips");
    assert.equal(lines.length, 1, "one honest line, whatever happened");
    assert.match(lines[0], /^\[town-drain\] skipped — TOWN_SINGLE_LOG is off/);
  } finally { o.close(); dropOdbHomes(); rmSync(clone, { recursive: true, force: true, maxRetries: 5 }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// F3 · IDEMPOTENCE — the crash-resume case, which is the one that will happen
// ═══════════════════════════════════════════════════════════════════════════

test("F3 · RE-RUN SAFE: a crash between the commit and the cursor costs nothing", async () => {
  // THE LAW, quoted from src/town-drain.mjs § writeTownDrain:
  says("src/town-drain.mjs", CURSOR_LAST_LAW,
    "the ordering this falsifier exists to price is stated in the module it governs");

  const clone = townClone();
  const o = liveShapeOdb();
  try {
    await flagOn(async () => {
      seedThreeClasses(o);
      seedLetter(o);
      const head = pendingRows(o).at(-1).seq;

      const first = await run(o, { clone, date: "2026-08-24" });
      assert.equal(first.drained, 3);
      const after = treeHash(clone);

      // THE CRASH: the record is written and pushed, and the process dies before
      // the cursor advance. Every row is pending again — which is exactly the
      // price the cursor-last ordering pays to never lose a household.
      o.prepare("INSERT OR REPLACE INTO meta VALUES (?, ?)").run(TOWN_DRAIN_CURSOR, "0");
      assert.equal(pendingRows(o).length, 3, "the resume state: all three rows pending again");

      const second = await run(o, { clone, date: "2026-08-24" });

      assert.equal(treeHash(clone), after,
        "THE RECORD IS BYTE-IDENTICAL: replaying a drained row must produce the tree it already produced");
      assert.equal(outboxFiles(clone, "wright").length, 1,
        "and the letter is not duplicated — the pen lane throws 409 on a second write, so the bridge checks the row's own recorded path first");
      assert.equal(second.letters[0].already, true,
        "…and SAYS it skipped rather than reporting a drain that did not happen");
      assert.equal(second.commit, null, "the join wrote the same bytes, so penCommit had an empty diff and made no commit");
      assert.equal(townDrainCursor(o), head, "and the cursor catches up");
    });
  } finally { o.close(); dropOdbHomes(); rmSync(clone, { recursive: true, force: true, maxRetries: 5 }); }
});

test("F3b · …and a third run over a drained log is simply nothing to do", async () => {
  const clone = townClone();
  const o = liveShapeOdb();
  try {
    await flagOn(async () => {
      seedThreeClasses(o);
      seedLetter(o);
      await run(o, { clone, date: "2026-08-24" });
      const after = treeHash(clone);
      const again = await run(o, { clone, date: "2026-08-24" });
      assert.equal(again.drained, 0);
      assert.equal(again.note, "nothing pending");
      assert.equal(treeHash(clone), after);
    });
  } finally { o.close(); dropOdbHomes(); rmSync(clone, { recursive: true, force: true, maxRetries: 5 }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// F4 · THE TRIPWIRE, EXTENDED TO THE INVOKER
// ═══════════════════════════════════════════════════════════════════════════

test("F4 · A CLASS THIS DRAIN CANNOT SETTLE STOPS THE WHOLE RUN", async () => {
  const clone = townClone();
  const o = liveShapeOdb();
  try {
    await flagOn(async () => {
      seedThreeClasses(o);
      ensureTownJournal(o);
      // Raw SQL ON PURPOSE: appendTownJournal already refuses a foreign class,
      // so a row can only reach this table past that guard — a hand-run
      // migration, a restored backup, a future class whose drain half does not
      // exist yet. The invoker is the LAST reader before a cursor moves past a
      // row forever, which is why the guard has to exist a second time here.
      o.prepare(`INSERT INTO town_journal (class, act, household, handle, payload, written_at)
                 VALUES ('mark', 'leave-mark', 'keemin', 'wright', '{}', '2026-08-24T00:00:00.000Z')`).run();
      assert.equal(TOWN_CLASSES.has("mark"), false, "the premise: 'mark' is the world log's class, not this one");

      const before = treeHash(clone);
      const pendingBefore = pendingRows(o).length;
      const r = await run(o, { clone, date: "2026-08-24" });

      assert.equal(r.refused, "foreign-class");
      assert.equal(r.drained, 0);
      assert.equal(treeHash(clone), before, "NOTHING was written — not even the two rows it did understand");
      assert.equal(townDrainCursor(o), 0, "and above all the cursor did not move");
      assert.equal(pendingRows(o).length, pendingBefore, "every row is still here");
      assert.match(r.skipped, /rows \d+:mark/, "the refusal names the row and the class, so an operator can go look");

      // Skipping the row instead would advance the cursor past something nothing
      // drained — which is the exact outcome the two-tables ruling was made to
      // prevent, in the founder's own words:
      says("src/town-journal.mjs", ONE_LOG_ONE_CONSUMER_LAW,
        "the founder's ruling the two-log split was made on");
    });
  } finally { o.close(); dropOdbHomes(); rmSync(clone, { recursive: true, force: true, maxRetries: 5 }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// F4b · A ROW THAT WILL NOT REPLAY DOES NOT BECOME A POISON ROW
// ═══════════════════════════════════════════════════════════════════════════

test("F4b · ONE BAD LETTER DOES NOT STOP THE BOAT — recorded, passed over, still in the log", async () => {
  const clone = townClone();
  const o = liveShapeOdb();
  try {
    await flagOn(async () => {
      // A letter to somebody the office has never heard of. The door judged this
      // letter when it wrote the row; between then and the boat the recipient
      // stopped being a resident, and enqueueLetter now throws 422 on replay.
      seedLetter(o, { to: "nobody-here", slug: "into-the-void" });
      seedLetter(o, { to: "limen", title: "a good letter", slug: "a-good-letter" });
      const head = pendingRows(o).at(-1).seq;

      const lines = [];
      const r = await run(o, { clone, date: "2026-08-24", log: (l) => lines.push(l) });

      // THE CHAIN IS `&&`-JOINED: letting the throw out would leave the cursor
      // unmoved and hold EVERY crossing after this one, forever. The mail would
      // stop over one row.
      assert.equal(r.ran, true, "the crossing completed");
      assert.equal(r.bounced, 1);
      assert.equal(r.letters[0].code, 422);
      assert.match(r.letters[0].bounced, /nobody-here/, "the defect is recorded verbatim, not summarised away");

      // …and the good letter still sailed
      assert.equal(r.letters[1].skipped, undefined);
      assert.equal(outboxFiles(clone, "wright").length, 1, "the letter behind the bad one is not held hostage by it");

      // NOTHING IS LOST, and this is only safe because this log is never
      // truncated: the world's drain does `DELETE FROM journal WHERE seq <= head`
      // and a row it passed over would be gone. Here the cursor is the only
      // thing that moves, so the bounced row is still sitting in the table.
      assert.equal(townDrainCursor(o), head);
      const still = o.prepare("SELECT COUNT(*) n FROM town_journal").get().n;
      assert.equal(still, 2, "both rows are still in town_journal — the drain truncates nothing");

      // and the operator is TOLD, on the one line they read
      assert.match(lines[0], /BOUNCED=1/,
        "a quiet crossing reads as quiet, so the bad day grows a word that has never been on this line before");
    });
  } finally { o.close(); dropOdbHomes(); rmSync(clone, { recursive: true, force: true, maxRetries: 5 }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// F5 · THE LOCK ASSERTION
// ═══════════════════════════════════════════════════════════════════════════

test("F5 · UNLOCKED: the drain writes the town clone, so it refuses to run beside the pen", async () => {
  const clone = townClone();
  const o = liveShapeOdb();
  try {
    await flagOn(async () => {
      seedThreeClasses(o);
      const before = treeHash(clone);
      const r = await run(o, { clone, lockHeld: () => false });

      assert.equal(r.refused, "unlocked");
      assert.equal(treeHash(clone), before);
      assert.equal(townDrainCursor(o), 0);
      assert.match(r.skipped, /must run under the ferry's flock/);

      // and `null` — the answer off linux, where there is no flock to consult —
      // is NOT a refusal: an unknowable lock must not stop a dev box.
      // PARENTHESISED ON PURPOSE. `await run(...).refused` reads `.refused` off
      // the PROMISE — always `undefined`, so the assertion passes whatever the
      // drain answers, and the un-awaited crossing then runs on into the next
      // test and clears the pool out from under it. The parentheses are the
      // whole difference between a probe and a decoration.
      assert.equal((await run(o, { clone, lockHeld: () => null })).refused, undefined,
        "unknowable is not the same answer as free, which is why townLockHeld has three values and not two");
    });
  } finally { o.close(); dropOdbHomes(); rmSync(clone, { recursive: true, force: true, maxRetries: 5 }); }
});

test("F5b · townLockHeld cannot guess: no flock, no answer", () => {
  assert.equal(townLockHeld({ flock: false }), null,
    "off linux the office's writes do not serialize through a flock, and the honest answer is that this cannot be known");
});

// ═══════════════════════════════════════════════════════════════════════════
// F6 · THE CURSOR'S OWN TABLE — the wave-4 bug the test fixtures were hiding
// ═══════════════════════════════════════════════════════════════════════════

test("F6 · THE LIVE LOG HAS NO `meta` UNTIL THE LOG MAKES ONE", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pm-odb-"));
  try {
    // THE PREMISE, and it is what made this a live bug rather than a tidy-up:
    // the town log lives in the office's oauth.db, and openOauthDb builds FIVE
    // tables, none of them `meta` — while every wave 1-3 fixture creates `meta`
    // by hand. So `advanceTownCursor` had never once run against the shape it
    // will actually meet, and would have thrown "no such table: meta" at the
    // END of the first real crossing, after the record was written and pushed,
    // at the one step whose whole job is to stop those rows replaying forever.
    const bare = openOauthDb(join(dir, "bare.db"));
    const tables = () => bare.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    assert.equal(tables().includes("meta"), false, "openOauthDb's own five tables carry no `meta`");
    bare.close();

    const clone = townClone();
    const o = liveShapeOdb();
    try {
      await flagOn(async () => {
        seedThreeClasses(o);
        const head = pendingRows(o).at(-1).seq;
        const r = await run(o, { clone, date: "2026-08-24" });
        assert.equal(r.ran, true);
        assert.equal(townDrainCursor(o), head,
          "the cursor is written into a table the log itself ensures — a function that writes a cursor owns the table the cursor sits in");
      });
    } finally { o.close(); dropOdbHomes(); rmSync(clone, { recursive: true, force: true, maxRetries: 5 }); }
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// F7 · ONE HONEST LINE PER DRAIN
// ═══════════════════════════════════════════════════════════════════════════

test("F7 · every run leaves exactly one line, and it says what happened", async () => {
  const clone = townClone();
  const o = liveShapeOdb();
  try {
    await flagOn(async () => {
      seedThreeClasses(o);
      seedLetter(o);
      const lines = [];
      const r = await run(o, { clone, date: "2026-08-24", log: (l) => lines.push(l) });
      assert.equal(lines.length, 1);
      assert.match(lines[0], /^\[town-drain\] date=2026-08-24 joins=1 updates=1 letters=1 head=\d+ cursor=\d+ commit=[0-9a-f]{40} took=\d+ms$/,
        "the counts, the head, the cursor and the commit — everything an operator needs to tell a quiet crossing from a broken one");
      assert.equal(drainLine(r).startsWith("[town-drain] "), true);
    });
  } finally { o.close(); dropOdbHomes(); rmSync(clone, { recursive: true, force: true, maxRetries: 5 }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// F8 · THE FERRY SLOT — the wiring, not just the code
// ═══════════════════════════════════════════════════════════════════════════

test("F8 · the unit runs the drain AFTER the crash recovery and BEFORE the sweep", () => {
  const unit = readFileSync(join(ROOT, "deploy", "postmark-ferry.service"), "utf8");
  const at = (needle) => { const i = unit.indexOf(needle); assert.notEqual(i, -1, `the unit no longer contains: ${needle}`); return i; };

  const clean = at('clean -fdq -- WHITE_PAGES');
  const drain = at("tools/town-drain-run.mjs");
  const sweep = at("node tools/ferry.mjs");

  assert.ok(clean < drain,
    "AFTER the reset/clean pair, which would otherwise throw away everything the drain just wrote");
  assert.ok(drain < sweep,
    "BEFORE the sweep, or a letter drained after it waits a whole extra crossing and the row's promise to its sender stops being true");
  assert.match(unit, /flock -w 300 \/srv\/postmark-office\/town\.lock/,
    "and inside the flock the chain already holds — which is why the bridge takes no lock of its own");
});

// ═══════════════════════════════════════════════════════════════════════════
// F9 · THE TOOL DESCRIPTION IS TRUE UNDER BOTH FLAG STATES
// ═══════════════════════════════════════════════════════════════════════════

test("F9 · send_letter no longer promises a commit it does not make flag-on", () => {
  const d = TOOLS.find((t) => t.name === "send_letter").description;

  // THE DEFECT: flag-on, sendLetterAsRow hands back `commit: null` and writes
  // no file at all. A description is not flag-switchable, so a sentence true in
  // only one state is a false sentence half the time.
  assert.equal(/committed to the town repo by the office pen/.test(d), false,
    "the door does not commit the letter when the flag is on");
  assert.equal(/commit/i.test(d), false, "and it does not name the plumbing at all — the act's meaning survives either engine");

  // …and what it must still say, because it is true in BOTH states and it is
  // the only part a sender can act on:
  assert.match(d, /DELIVERED ON THE NEXT FERRY CROSSING/);
  assert.match(d, /Nothing reaches your recipient before that boat/);
  assert.match(d, /Slow-mail town/);

  // THE FIVE PAPER DOORS ARE NOT TOUCHED, and that is a finding rather than an
  // omission. Their dispatch (mcp.mjs § the paper acts) calls the door FIRST and
  // logs the row after — `const out = verb(args, key, db, clone)` runs whatever
  // the flag says — so the pen commit still happens flag-on and the drain's
  // replay is an equivalence check rather than the only writer. "Lands as a pen
  // commit" is therefore true in BOTH states, and truing a true sentence would
  // have been a change with no defect behind it.
  const descOf = (n) => TOOLS.find((x) => x.name === n)?.description ?? "";
  for (const spec of Object.values(PAPER_ACTS)) {
    if (spec.tool === "update_window") continue; // says it its own way, checked below
    assert.match(descOf(spec.tool), /Lands as a pen commit\./,
      `${spec.tool} still pen-commits under both flag states — this sentence was never wrong`);
  }
  assert.match(descOf("update_window"), /it appears on your resident page on the next office tick/,
    "the window door never said 'pen commit'; it names the tick, which is equally true either side of the flag");
});

// ═══════════════════════════════════════════════════════════════════════════
// F10 · THE CONSENT DOOR JOINS THE FREEZE
// ═══════════════════════════════════════════════════════════════════════════

test("F10 · WORLD_FREEZE bounces the stance door with the same 503 as the other ten", async () => {
  delete process.env.WORLD_FREEZE;
  assert.equal(worldFreezeBounce(), null, "flag-off the gate is null and the door is byte-identical");

  process.env.WORLD_FREEZE = "1";
  try {
    const expected = worldFreezeBounce();
    const got = await declareStanceViaOffice("/nonexistent-repo", { on: "someone/a-mark", stance: "welcomed" }, key);

    assert.deepEqual(got, expected,
      "one gate, one shape: a resident must not be able to tell which door they hit from the answer they got");
    assert.equal(got.code, 503);
    assert.match(got.hint, /stances/,
      "and the freeze's own hint already named stances as a ground act — the door was simply missing from the list");

    // FIRST, ahead of the log check: a frozen world's answer must not depend on
    // whether the office it reached happens to run WORLD_SINGLE_LOG.
    assert.equal(got.error, "bounce", "returned, not thrown — the one shape all eleven doors speak");
  } finally { delete process.env.WORLD_FREEZE; }
});

test("F10b · flag-off, the stance door answers as it always did", async () => {
  delete process.env.WORLD_FREEZE;
  delete process.env.WORLD_SINGLE_LOG;
  await assert.rejects(() => declareStanceViaOffice("/nonexistent-repo", { on: "someone/a-mark", stance: "welcomed" }, key),
    (e) => e.code === 501,
    "unfrozen, the door reaches its own 501 exactly as before the gate was added");
});

// ═══════════════════════════════════════════════════════════════════════════
// F11 · BOTH SKINS ANSWER `your_pending_edits` IDENTICALLY
// ═══════════════════════════════════════════════════════════════════════════

test("F11 · PARITY: the same fixture, both skins, deep-equal", async () => {
  says("src/doorstep-bundle.mjs", BOTH_SKINS_LAW,
    "the law this falsifier enforces is written where the block lives");

  const tmp = mkdtempSync(join(tmpdir(), "pm-parity-"));
  const clone = townClone();
  let child;
  try {
    const dbPath = join(tmp, "fixture.db");
    fixtureDb(dbPath).close();

    // one log, one pending paper act, belonging to the key's own resident
    const odbPath = join(tmp, "oauth.db");
    const o = openOauthDb(odbPath);
    appendTownJournal(o, {
      cls: "update", act: "window", household: "keemin", handle: "wright",
      payload: { args: { handle: "wright", html: "<p>hung, not yet settled</p>" } },
    });
    o.close();

    const PORT = 43877;
    const BASE = `http://127.0.0.1:${PORT}`;
    const KEY = "paritykey";
    child = spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", String(PORT), "--db", dbPath, "--oauth-db", odbPath], {
      env: {
        ...process.env, TOWN_SINGLE_LOG: "1", OFFICE_KEYS: `${KEY}=keemin:wright`,
        TOWN_CLONE: clone, WORLD_CLONE: join(tmp, "no-world"), VOICES_LOG: join(tmp, "voices.jsonl"), TOWN_PUSH: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise((ok, no) => {
      const t = setTimeout(() => no(new Error("server never listened")), 15_000);
      child.stdout.on("data", (d) => { if (String(d).includes("listening")) { clearTimeout(t); ok(); } });
      child.on("exit", (c) => no(new Error(`server exited early (${c})`)));
    });

    // THE REST SKIN
    const rest = await (await fetch(`${BASE}/doorstep/wright`, { headers: { authorization: `Bearer ${KEY}` } })).json();

    // THE MCP SKIN — same process, same log, same key, same resident
    const rpc = await (await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "read_doorstep", arguments: { handle: "wright" } } }),
    })).json();
    const mcp = JSON.parse(rpc.result.content[0].text);

    assert.ok(rest.your_pending_edits, "the REST doorstep discloses the caller's own un-settled paper edit");
    assert.ok(mcp.your_pending_edits, "…and so does the MCP doorstep");
    assert.deepEqual(rest.your_pending_edits, mcp.your_pending_edits,
      "DEEP-EQUAL: the tense is a property of the town, not of the client that asked");
    assert.equal(rest.your_pending_edits.pending[0].act, "window");
    assert.equal(rest.your_pending_edits.pending[0].file, PAPER_ACTS.window.file("wright"));
  } finally {
    if (child && child.exitCode === null) {
      const gone = new Promise((ok) => child.on("exit", ok));
      child.kill();
      await gone; // Windows: the db stays locked until the child is truly down
    }
    rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    rmSync(clone, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// F12 · THE DOORS MAP NAMES EVERY ACT THE LOG CAN CARRY
// ═══════════════════════════════════════════════════════════════════════════

test("F12 · every paper act and the mail door have a door to replay through", () => {
  for (const [act, spec] of Object.entries(PAPER_ACTS))
    assert.equal(typeof TOWN_DOORS[spec.tool], "function",
      `"${act}" logs rows the drain must replay through ${spec.tool}, and a missing key here is a row that silently never settles`);
  assert.equal(typeof TOWN_DOORS[MAIL_DOOR], "function");
  // …and send_letter is bound to the FLAG-OFF pen on purpose: the flag decides
  // whether a letter becomes a row at the door, and the drain is what turns the
  // row into the file. Binding the flag-on door would write a row for the row
  // it is draining.
  assert.equal(TOWN_DOORS[MAIL_DOOR].name, "enqueueLetter");
});
