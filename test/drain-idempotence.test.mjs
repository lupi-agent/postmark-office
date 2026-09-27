// drain-idempotence.test.mjs — #2302: a logged paper act replays at the
// crossing against a file that may have changed since, and a harmless clear
// becomes a delete.
//
//   node --test test/drain-idempotence.test.mjs
//
// ── THE LAW THIS FILE HOLDS, QUOTED ────────────────────────────────────────
//
// town-updates.mjs § logPaperAct states the drain's whole contract in one
// sentence, and every falsifier below is that sentence made checkable:
//
//   "The row carries the door's arguments VERBATIM, because the drain's whole
//    contract is that replaying them through the door reproduces the commit."
//
// REPRODUCES the commit. Not "makes a new and different one". That holds only
// while the file is what it was when the door read it, and until this fix
// nothing checked that it was.
//
// ── THE INSTANCE, ON THE RECORD ────────────────────────────────────────────
//
// The postmaster's own card, 2026-08-30/31, three commits in the town repo:
//
//   23827b01  avatar set through the door — PROFILE.md founded, `avatar:` only
//   c8235671  four fields hand-added to WHITE_PAGES/postmaster/PROFILE.md
//             (road #1 of TOWN_BULLETIN/build-your-profile.md, which
//             self-certifies by design — hand-editing your own card is a
//             first-class road the town advertises)
//   63a38162  12:00:24Z, exactly at the crossing — the replay DELETED all four,
//             under updateProfileUnlogged's own commit wording rather than a
//             settler's, `avatar:` and the body untouched
//
// The middle step is a resident doing what the bulletin tells them to do. The
// third is the office eating it. F1 below is that sequence, end to end.
//
// ── WHAT MUST NOT BE TRADED FOR IT ─────────────────────────────────────────
//
// The cursor advances LAST, after the record is durable, so a crash between the
// commit and the advance leaves already-written rows still pending and the next
// crossing replays them. That replay is the whole reason the log survives a
// crash, and a guard that skipped it would trade data loss for LOST ACTS. F3
// and F4 are that half: a row whose work is not in this clone's history still
// replays, and a row that carries no outcome at all (every row written before
// this fix) replays exactly as it did.

import "./helpers/drain-pen.mjs"; // #2040: fixtures get a real ledger pen
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { fixtureDb } from "./fixture.mjs";
import { openOauthDb } from "../src/oauth.mjs";
import { ensureTownJournal, readTownJournal, appendTownJournal } from "../src/town-journal.mjs";
import { paperActCommits } from "../src/town-updates.mjs";
import { updateProfile, updateAddressBody } from "../src/edit.mjs";
import { runTownDrain, TOWN_DOORS, isAncestorOfHead } from "../src/town-bridge.mjs";
import { withRecordFrom } from "./registry-pool-stub.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
delete process.env.TOWN_PUSH; // nothing here may leave the machine

// ── fixtures ────────────────────────────────────────────────────────────────

const trash = [];
const scratch = (tag) => { const d = mkdtempSync(join(tmpdir(), `pm-${tag}-`)); trash.push(d); return d; };
test.after(() => { for (const d of trash.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 5 }); });

const git = (dir, ...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();

/**
 * A town clone holding the postmaster's card AS 23827b01 LEFT IT: founded by
 * the avatar door, so it carries `avatar:` and a body and NONE of the four
 * fields the profile door writes. That absence is the whole trap — a call that
 * clears them is a documented no-op against this file and a delete against the
 * one the resident is about to hand-write.
 */
function postmasterClone() {
  const dir = scratch("2302-clone");
  mkdirSync(join(dir, "WHITE_PAGES", "postmaster"), { recursive: true });
  writeFileSync(join(dir, "WHITE_PAGES", "postmaster", "PROFILE.md"),
    '---\nhandle: postmaster\navatar: "avatar.png"\n---\n\nThe office keeps the town\'s paper.\n');
  writeFileSync(join(dir, "WHITE_PAGES", "postmaster", "ADDRESS.md"),
    "---\nhandle: postmaster\ngithub: keeminlee\nsince: 2026-01-01\n---\n\n# postmaster\n");
  mkdirSync(join(dir, "tools"), { recursive: true });
  writeFileSync(join(dir, "tools", "households.json"),
    JSON.stringify({ schema_version: 1, households: {} }, null, 2) + "\n");
  git(dir, "init", "-q");
  git(dir, "add", "-A");
  git(dir, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid",
    "commit", "-q", "-m", "23827b01 (stand-in): postmaster: profile founded (via postmark-office)");
  return dir;
}

const logHome = () => join(scratch("2302-odb"), "oauth.db");

const KEY = { household: "office", handles: new Set(["postmaster"]), ghId: "7", ghLogin: "keeminlee" };
const db = fixtureDb();

// ASYNC-AWARE (POS-158). `return fn(o)` handed back a promise and the `finally`
// then closed the db and cleared the flag while the drain was still running —
// which is a teardown racing the thing it is tearing down, and it fails
// somewhere else. It awaits now.
const withLog = async (fn) => {
  process.env.TOWN_SINGLE_LOG = "1";
  const o = openOauthDb(logHome());
  try { ensureTownJournal(o); return await fn(o); }
  finally { o.close(); delete process.env.TOWN_SINGLE_LOG; }
};

// AWAITED AND POINTED AT THE RECORD (POS-158). The crossing reads the town's
// registry from the store and writes its membership rows there, so this helper
// seeds the store from whatever registry the clone already holds — which is the
// same fixture this suite was already writing — and awaits the drain.
const drain = (o, clone) =>
  withRecordFrom(clone, () =>
    runTownDrain(o, { db, clone, doors: TOWN_DOORS, date: "2026-08-31", lockHeld: () => true, log: () => {} }));

const profileOf = (clone) => readFileSync(join(clone, "WHITE_PAGES", "postmaster", "PROFILE.md"), "utf8");

/** The hand edit of c8235671 — road #1 of the bulletin, made by its owner. */
function handAddFourFields(clone) {
  const file = join(clone, "WHITE_PAGES", "postmaster", "PROFILE.md");
  writeFileSync(file, readFileSync(file, "utf8").replace('avatar: "avatar.png"',
    'avatar: "avatar.png"\ncolor: "#8b5a2b"\ncolor_name: "postal brown"\n'
    + 'bio: "keeper of the town\'s paper"\nruntime: "the office"'));
  git(clone, "add", "-A");
  git(clone, "-c", "user.name=postmaster", "-c", "user.email=postmaster@postmark.invalid",
    "commit", "-q", "-m", "c8235671 (stand-in): postmaster fills in their own card by hand");
  return git(clone, "rev-parse", "HEAD");
}

const FOUR = ["color:", "color_name:", "bio:", "runtime:"];

// ═══════════════════════════════════════════════════════════════════════════
// F1 · THE POSTMASTER'S OWN SEQUENCE — the four fields survive the crossing
// ═══════════════════════════════════════════════════════════════════════════
//
// FLIP-PROVEN: run this file at release/2026-w36.9 and F1 is RED — the drain
// reports one replayed update and the assertion on `color:` fails, because the
// no-op row was logged and its args were re-imposed. That red IS 63a38162.

test("F1 · a door no-op, a hand edit, a crossing — the four fields SURVIVE (#2302, 63a38162)", async () => {
  const clone = postmasterClone();
  await withLog(async (o) => {
    // 1. the door call of the instance: four fields cleared, against a file
    //    that has none of them. Documented no-op — the door says so itself.
    const out = updateProfile(
      { handle: "postmaster", color: "", color_name: "", bio: "", runtime: "" },
      KEY, db, clone, o);
    assert.equal(out.unchanged, true, "the door call was a no-op — that is the premise, not the bug");
    assert.equal(out.commit, null, "and it landed no commit");
    assert.deepEqual(paperActCommits(out), [], "so its whole outcome is the empty list");

    // THE COMPANION FIX: a row that wrote nothing is not written down.
    assert.deepEqual(readTownJournal(o), [],
      "a documented no-op has nothing to settle, so it must not be logged — a row that wrote nothing can only re-impose args at the crossing");
    assert.equal(out.logged, undefined, "and the caller is not told an edit is pending when none is");

    // 2. the resident does what TOWN_BULLETIN/build-your-profile.md tells them to.
    handAddFourFields(clone);
    const byHand = profileOf(clone);
    for (const f of FOUR) assert.ok(byHand.includes(f), `precondition: ${f} is on the card by hand`);

    // 3. the crossing.
    const r = await drain(o, clone);
    assert.equal(r.ran, true, "the crossing ran");
    assert.equal(r.counts.update, 0, "and had no update row to replay, because none was ever written");

    const after = profileOf(clone);
    for (const f of FOUR)
      assert.ok(after.includes(f),
        `#2302: ${f} was hand-written by its owner and the crossing DELETED it — this is 63a38162`);
    assert.ok(after.includes('avatar: "avatar.png"'), "the avatar survives, as it did in the instance");
    assert.ok(after.includes("The office keeps the town's paper."), "and so does the body");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// F2 · THE GUARD ITSELF — a real act, a hand edit on top, no re-imposition
// ═══════════════════════════════════════════════════════════════════════════
//
// F1's row never existed, so it never reached the guard. This one does: an act
// that genuinely committed, whose sha the row now carries, replayed after the
// resident wrote more onto the same file. Same class, and the half the
// companion fix cannot reach — the door DID write, so the row is real.

test("F2 · a row whose commit is already behind HEAD is `already`, not replayed", async () => {
  const clone = postmasterClone();
  await withLog(async (o) => {
    const out = updateProfile({ handle: "postmaster", bio: "keeper of the paper" }, KEY, db, clone, o);
    assert.ok(out.commit, "the door landed a real commit");
    const [row] = readTownJournal(o);
    assert.deepEqual(row.payload.commits, [out.commit],
      "and the row records it — the resume key, exactly as `payload.file` is a letter's");

    // the resident then adds a colour by hand, on top of the office's commit
    const file = join(clone, "WHITE_PAGES", "postmaster", "PROFILE.md");
    writeFileSync(file, readFileSync(file, "utf8").replace("handle: postmaster",
      'handle: postmaster\ncolor: "#8b5a2b"'));
    git(clone, "add", "-A");
    git(clone, "-c", "user.name=postmaster", "-c", "user.email=postmaster@postmark.invalid",
      "commit", "-q", "-m", "postmaster adds a colour by hand");

    const head = git(clone, "rev-parse", "HEAD");
    const r = await drain(o, clone);
    assert.equal(r.updates.length, 1, "the row was read");
    assert.equal(r.updates[0].already, true, "and recognised as already applied");
    assert.deepEqual(r.updates[0].commits, [out.commit], "by its own recorded sha");
    assert.equal(git(clone, "rev-parse", "HEAD"), head, "the crossing wrote nothing on top");
    assert.ok(profileOf(clone).includes('color: "#8b5a2b"'), "the hand-written colour survives");
    assert.ok(profileOf(clone).includes("keeper of the paper"), "and so does the door's own bio");
  });
});

// F2 asserts the mechanism (`already`). F2b asserts the OUTCOME, and it is the
// one that was flip-proven red at release/2026-w36.9 alongside F1: a clear that
// DID commit is a real row the companion no-op filter can never reach, so only
// the ancestor guard stands between it and the resident's rewrite.

test("F2b · a committed clear is not re-imposed over the rewrite that superseded it", async () => {
  const clone = scratch("2302-reclear");
  mkdirSync(join(clone, "WHITE_PAGES", "postmaster"), { recursive: true });
  writeFileSync(join(clone, "WHITE_PAGES", "postmaster", "PROFILE.md"),
    '---\nhandle: postmaster\nbio: "the old bio"\n---\n\nThe office keeps the town\'s paper.\n');
  mkdirSync(join(clone, "tools"), { recursive: true });
  writeFileSync(join(clone, "tools", "households.json"),
    JSON.stringify({ schema_version: 1, households: {} }, null, 2) + "\n");
  git(clone, "init", "-q"); git(clone, "add", "-A");
  git(clone, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid",
    "commit", "-q", "-m", "fixture: a profile with a bio");

  await withLog(async (o) => {
    const out = updateProfile({ handle: "postmaster", bio: "" }, KEY, db, clone, o);
    assert.ok(out.commit, "premise: clearing a field that was really there really commits");
    const file = join(clone, "WHITE_PAGES", "postmaster", "PROFILE.md");
    assert.ok(!readFileSync(file, "utf8").includes("bio:"), "and the bio is gone, as asked");

    // the resident changes their mind and writes a new one by hand
    writeFileSync(file, readFileSync(file, "utf8").replace("handle: postmaster",
      'handle: postmaster\nbio: "on second thought, this one"'));
    git(clone, "add", "-A");
    git(clone, "-c", "user.name=postmaster", "-c", "user.email=postmaster@postmark.invalid",
      "commit", "-q", "-m", "postmaster writes a new bio by hand");

    const r = await drain(o, clone);
    assert.equal(r.updates[0].already, true, "the clear is already in the history");
    assert.ok(readFileSync(file, "utf8").includes("on second thought, this one"),
      "#2302: the replay re-imposed a clear the resident had already superseded by hand");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// F3 · THE OTHER FAILURE — a genuinely unapplied row STILL replays
// ═══════════════════════════════════════════════════════════════════════════
//
// The reason the drain replays at all: the cursor advances after the record is
// durable, so a crash in between leaves written rows pending and the next
// crossing must redo them. The ferry unit's own crash recovery is `git reset
// --hard` on the clone, which is exactly the shape below — the commit the row
// names is no longer in this clone's history, and the act must land again.

test("F3 · a row whose commit is NOT behind HEAD replays — no act is lost", async () => {
  const clone = postmasterClone();
  await withLog(async (o) => {
    const out = updateProfile({ handle: "postmaster", bio: "keeper of the paper" }, KEY, db, clone, o);
    assert.ok(out.commit, "the door committed");

    // the crash recovery the ferry unit runs at ExecStart, which throws the
    // office's un-drained commit away
    git(clone, "reset", "--hard", "-q", "HEAD~1");
    assert.equal(isAncestorOfHead(clone, out.commit), false, "the sha is genuinely gone from this history");
    assert.ok(!profileOf(clone).includes("keeper of the paper"), "and so is the edit");

    const r = await drain(o, clone);
    assert.equal(r.updates.length, 1);
    assert.notEqual(r.updates[0].already, true, "an unapplied row must not be skipped");
    assert.ok(r.updates[0].commit, "it replayed and committed");
    assert.ok(profileOf(clone).includes("keeper of the paper"),
      "the act the resident was promised at the crossing landed — the guard must not trade data loss for lost acts");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// F4 · COMPATIBILITY — a row from before this fix replays exactly as before
// ═══════════════════════════════════════════════════════════════════════════
//
// Every update row already in the production log was written without a
// `commits` field. ABSENT IS NOT EMPTY: reading the missing field as "landed
// nothing, so nothing to redo" would silently un-settle every one of them. The
// conservative grandfather is to replay as before, and this is that decision
// made checkable rather than left to absent-reads-as-falsy.

test("F4 · a commit-less legacy row is grandfathered — replayed as before", async () => {
  const clone = postmasterClone();
  await withLog(async (o) => {
    // the pre-fix row shape, written by hand: args only, no outcome
    appendTownJournal(o, {
      cls: "update", act: "profile", household: "office", handle: "postmaster",
      ghId: "7", ghLogin: "keeminlee", channel: null,
      payload: { args: { handle: "postmaster", bio: "written before the fix" } },
    });
    const [row] = readTownJournal(o);
    assert.equal(row.payload.commits, undefined, "precondition: the legacy row carries no outcome");

    const r = await drain(o, clone);
    assert.equal(r.updates.length, 1);
    assert.notEqual(r.updates[0].already, true, "an absent outcome is not an empty one");
    assert.ok(profileOf(clone).includes("written before the fix"), "the legacy row settled, as it always did");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// F5 · THE COMING TWO-FILE ACT — the guard covers the WHOLE outcome
// ═══════════════════════════════════════════════════════════════════════════
//
// On the w37 train the profile act grows `display_name`, routed to the ADDRESS
// card through updateAddressFieldsUnlogged and handed back nested as `named`.
// One row, TWO commits — and a display-name-only call returns `commit: null,
// unchanged: true` at the top level while `named.commit` holds a real sha. A
// guard that read only `out.commit` would call that act a no-op, decline to log
// it, and lose the resident's shown name; one that skipped on ANY sha matching
// would pass over an act whose second half never landed. Both halves, or replay.

test("F5 · paperActCommits reads the act's whole outcome, not just the top level", async () => {
  assert.deepEqual(paperActCommits({ commit: "a".repeat(40) }), ["a".repeat(40)],
    "the one-commit shape");
  assert.deepEqual(
    paperActCommits({ commit: "b".repeat(40), named: { file: "WHITE_PAGES/x/ADDRESS.md", commit: "c".repeat(40) } }),
    ["b".repeat(40), "c".repeat(40)],
    "the w37 two-file shape — both halves");
  assert.deepEqual(
    paperActCommits({ commit: null, unchanged: true, named: { commit: "d".repeat(40) } }),
    ["d".repeat(40)],
    "a display-name-only call is NOT a no-op: the top level says unchanged and the act still wrote");
  assert.deepEqual(paperActCommits({ commit: null, unchanged: true, named: null }), [],
    "and one that truly wrote nothing is the empty list");
});

test("F5b · a two-commit row replays unless EVERY sha is behind HEAD", async () => {
  const clone = postmasterClone();
  await withLog(async (o) => {
    const out = updateAddressBody({ handle: "postmaster", body: "the office window" }, KEY, db, clone, o);
    assert.ok(out.commit, "one real commit landed");
    // the row as the w37 two-file act would write it: the landed half plus a
    // half this clone has never seen
    appendTownJournal(o, {
      cls: "update", act: "profile", household: "office", handle: "postmaster",
      ghId: "7", ghLogin: "keeminlee", channel: null,
      payload: { args: { handle: "postmaster", bio: "the second half never landed" },
        commits: [out.commit, "e".repeat(40)] },
    });

    const r = await drain(o, clone);
    const two = r.updates.find((u) => u.seq === 2);
    assert.notEqual(two.already, true,
      "one half in the history is not the act — a partially-applied act must replay");
    assert.ok(profileOf(clone).includes("the second half never landed"), "and it did");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// F6 · THE LAW IS STILL WRITTEN WHERE THE FALSIFIERS QUOTE IT FROM
// ═══════════════════════════════════════════════════════════════════════════

test("F6 · the contract sentence this fix makes true again is still in town-updates.mjs", async () => {
  // the jsdoc prefix is stripped before the quote is looked for, so the law may
  // be re-wrapped without this going red — only a REWORDING breaks it
  const src = readFileSync(join(ROOT, "src", "town-updates.mjs"), "utf8")
    .replace(/^\s*\*/gm, "").replace(/\s+/g, " ");
  assert.ok(src.includes(
    "the drain's whole contract is that replaying them through the door reproduces the commit"),
  "the falsifiers above are that sentence made checkable — if it is reworded, they are quoting a law that no longer exists");
});

// ═══════════════════════════════════════════════════════════════════════════
// F7 · THE REAL TWO-FILE ACT (w37 only — the display_name→agent sugar)
// ═══════════════════════════════════════════════════════════════════════════
//
// F5/F5b hold the shape synthetically, because the hotfix branch is cut from
// release/2026-w36.9 where `named` does not exist yet. Here it does, so this is
// the same property proved against the door itself: one row, two files, two
// commits, and a display-name-only call whose top level says `unchanged: true`
// while its ADDRESS half really wrote. The forward-port exists so the train
// does not regress the hotfix at the w37 release; this is the falsifier that
// says it did not.

test("F7 · the two-file profile act records BOTH commits, and a name-only call is not a no-op", async () => {
  const clone = postmasterClone();
  await withLog(async (o) => {
    // a call that touches both files: a bio (PROFILE.md) and a shown name
    // (ADDRESS.md's `agent`, through its own writer)
    const both = updateProfile(
      { handle: "postmaster", bio: "keeper of the paper", display_name: "The Postmaster" },
      KEY, db, clone, o);
    assert.ok(both.commit, "the PROFILE.md half committed");
    assert.ok(both.named?.commit, "and the ADDRESS.md half committed too");
    assert.notEqual(both.commit, both.named.commit, "two files, two commits, one act");

    const [row] = readTownJournal(o);
    assert.deepEqual(new Set(row.payload.commits), new Set([both.commit, both.named.commit]),
      "the row records the act's WHOLE outcome, not just the half it thinks of as its own");

    // a display-name-only call: `commit: null, unchanged: true` at the top
    // level, and a real sha underneath. It must still be logged.
    const nameOnly = updateProfile({ handle: "postmaster", display_name: "Postmaster General" },
      KEY, db, clone, o);
    assert.equal(nameOnly.commit, null, "the top level reports no commit");
    assert.equal(nameOnly.unchanged, true, "and calls itself unchanged");
    assert.ok(nameOnly.named?.commit, "while the shown name really landed");
    const rows = readTownJournal(o);
    assert.equal(rows.length, 2,
      "a name-only call is NOT a documented no-op — dropping it would lose the resident's shown name");
    assert.deepEqual(rows[1].payload.commits, [nameOnly.named.commit], "and it carries the sha that did land");

    // the crossing: both rows are already in the history, so neither replays
    const head = git(clone, "rev-parse", "HEAD");
    const r = await drain(o, clone);
    assert.deepEqual(r.updates.map((u) => u.already), [true, true], "both acts are already applied");
    assert.equal(git(clone, "rev-parse", "HEAD"), head, "and the crossing wrote nothing on top");
    assert.ok(readFileSync(join(clone, "WHITE_PAGES", "postmaster", "ADDRESS.md"), "utf8")
      .includes("Postmaster General"), "the shown name survived the crossing");
  });
});
