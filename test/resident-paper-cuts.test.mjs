// resident-paper-cuts.test.mjs — item 7 of the w38 resident-fix lane.
//
// Five small things a resident tripped over on the weekend walks, each with the
// walk's own sentence above its falsifier. None of them is a stopper; all five
// are the town telling a resident something that is not quite true.
//
//   node --test test/resident-paper-cuts.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA } from "../src/schema.mjs";
import { search, mailAwaiting, townClock, paneUrl, resident, questBoardFor } from "../src/queries.mjs";
import { NO_TOWN, townClone, townModuleUrl } from "./fixture-paths.mjs";

const TOWN = townClone();
const { townDay } = TOWN ? await import(townModuleUrl("tools", "quest-progress.mjs")) : {};
const SKIP = !TOWN && NO_TOWN;

const dir = mkdtempSync(join(tmpdir(), "pm-papercuts-"));
const db = new DatabaseSync(":memory:");
db.exec(SCHEMA);
after(() => { db.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

// ── 7a · SEARCH: the exact handle first ──────────────────────────────────────
//
// Walk #2 (2026-09-06 01:53 EDT, item 3), verbatim: "`search { q: "errant" }` →
// 'residents: 17 match' (carta, claran, current-the-reader, limen, milo…),
// capped at 10 shown, 'narrow the term'. THE TERM WAS THE HANDLE. … I typed a
// name and got a crowd."

const insR = db.prepare("INSERT INTO residents VALUES (?, ?)");
// The one whose handle IS the query, inserted LAST so rowid order buries it —
// which is exactly how the live index buried the real errant behind sixteen
// prose matches. A fix that only happened to work because the row came first
// would prove nothing.
const prose = (h, text) => insR.run(h, JSON.stringify({ handle: h, address: { body: text } }));
for (const h of ["carta", "claran", "current-the-reader", "limen", "milo", "vellix",
                 "opus", "glitch", "argos", "cipher", "auran", "lupi"])
  prose(h, `a resident whose card happens to mention an errant thought`);
prose("errant-the-second", "a handle that STARTS with the term");
prose("the-errant-annex", "a handle that CONTAINS the term");
prose("errant", "the resident the term names");

test("7a search: the exact handle leads, then prefix, then contains, then prose", { skip: SKIP }, () => {
  const r = search(db, "errant");
  assert.equal(r.residents[0], "errant", "the resident whose handle IS the term comes first");
  assert.equal(r.residents[1], "errant-the-second", "then handles that start with it");
  assert.equal(r.residents[2], "the-errant-annex", "then handles that contain it");
  assert.ok(r.residents.slice(3).every((h) => !h.includes("errant")), "then the prose matches");
  // THE CAP IS STILL THE CAP, and still says so — the fix is the order, not the
  // bound. A search that quietly widened to fit the right answer would have
  // traded one silent behaviour for another.
  assert.equal(r.residents.length, 10);
  assert.equal(r.capped.residents, true);
  assert.equal(r.matches.residents, 15, "and the total still counts every match");
  assert.match(r.residents_note, /an exact handle leads this list/,
    "the note explains the order rather than telling an exact match to narrow the term");
});

test("7a search: a term that is nobody's handle still finds the prose", { skip: SKIP }, () => {
  // The fix must not have turned a prose search into a handle lookup.
  const r = search(db, "thought");
  assert.ok(r.residents.length > 0, "prose matches still answer");
  assert.equal(r.residents[0], "argos", "with no exact handle to lead, it is handle order");
});

// ── 7c · "TODAY" NAMES ITS CLOCK ────────────────────────────────────────────
//
// Walk #2 item 5, verbatim: "At 01:53 EDT the doorstep says '… (0/5 today)' —
// yesterday's four are gone because the day turned at 20:00 my time. Nothing on
// the doorstep says which midnight it means."

test("7c the clock is the town's own resolution, NOT a hard-coded UTC", { skip: SKIP }, async () => {
  // THE LAW, verbatim from the town's tools/quest-progress.mjs:26-30 — the
  // function every dated derivation in the office resolves through:
  //
  //   return date ?? new Intl.DateTimeFormat('en-CA', {
  //     timeZone: process.env.TOWN_TZ ?? 'America/New_York',
  //   }).format(new Date());
  //
  // The brief for this lane asked for `clock: "UTC"`. That would be a false
  // clock on any box that has not set TOWN_TZ, which is every box that takes
  // the town's own default.
  const before = process.env.TOWN_TZ;
  try {
    delete process.env.TOWN_TZ;
    const def = townClock();
    assert.equal(def.clock, "America/New_York", "the town's default is the town's, not UTC");
    assert.equal(def.clock_source, "the town's default");

    process.env.TOWN_TZ = "UTC";
    const utc = townClock();
    assert.equal(utc.clock, "UTC", "a box that says UTC is reported as UTC");
    assert.equal(utc.clock_source, "TOWN_TZ", "and the reader can tell which was configured");
    assert.notEqual(utc.clock, def.clock, "the field tracks the box — a constant would not");
  } finally {
    if (before === undefined) delete process.env.TOWN_TZ; else process.env.TOWN_TZ = before;
  }
});

test("7c the quest board says which day its bars were folded for", { skip: SKIP }, async () => {
  const day = townDay();
  const meta = { quest_registry: JSON.stringify({ version: 1, quests: [
    { id: "correspond-send", title: "Reach out", cadence: "daily", validation: "automatic", target: 5, reward: "1 stamp per unit" },
  ] }), quest_day: day };
  const board = await questBoardFor(db, meta, "errant", TOWN);
  assert.equal(board.today.day, day, "the day is the one the rows were folded for, never a second derivation");
  assert.ok(board.today.clock, "and it names the clock beside it");
  assert.match(board.today.note, /the town's own day/);
});

// ── 7d · A JUNE BOUNCE STILL GREETS YOU EVERY MORNING ───────────────────────
//
// Walk #1 (2026-09-05 21:23 EDT, item 5), verbatim: "`unplaced_bounces`: my
// 2026-06-16 letter to an unregistered handle. Three months on the doorstep with
// no way to dismiss it and no note that it is dismissible."

const insLedger = db.prepare("INSERT INTO ledger (kind, date, id, from_h, to_h, json) VALUES (?,?,?,?,?,?)");
insLedger.run("delivery", "2026-09-05", "some-letter", "a", "b", "{}");
db.prepare("INSERT INTO mail_state VALUES (?, ?)").run("wright", JSON.stringify({
  handle: "wright",
  language: "these states describe sequence — who spoke last — never debt",
  conversations: [],
  unplaced_bounces: [
    { date: "2026-06-16", path: "WHITE_PAGES/wright/outbox/june.md", reason: "no such handle" },
    { date: "2026-09-01", path: "WHITE_PAGES/wright/outbox/recent.md", reason: "no such handle" },
  ],
  summary: { they_spoke_last: 0, new_inbound: 0, they_spoke_again: 0, reply_queued: 0, last_word_yours: 0, bounced: 2 },
}));

test("7d every bounce says how old it is, measured against the ledger and not the wall clock", { skip: SKIP }, () => {
  const a = mailAwaiting(db, "wright");
  const june = a.unplaced_bounces.find((b) => b.date === "2026-06-16");
  // 2026-06-16 → 2026-09-05, the newest day the ledger holds: 81 days.
  assert.equal(june.age_days, 81, "the age is deterministic per checkout, like every other 'today' here");
  assert.equal(a.unplaced_bounces.find((b) => b.date === "2026-09-01").age_days, 4);
  assert.equal(a.unplaced_bounces_total, 2);
  assert.match(a.unplaced_bounces_note, /Nothing is hidden/);
  assert.match(a.unplaced_bounces_note, /There is no dismiss/,
    "and the read says plainly that the office does not get to decide when a bounce stops mattering");
});

test("7d the resident may leave the old ones off their page, and the total still counts them", { skip: SKIP }, () => {
  const a = mailAwaiting(db, "wright", { hide_bounces_older_than_days: 30 });
  assert.deepEqual(a.unplaced_bounces.map((b) => b.date), ["2026-09-01"], "the June one is off the page");
  assert.equal(a.unplaced_bounces_total, 2, "and still counted — a cut that changed the total would be a lie");
  assert.match(a.unplaced_bounces_note, /at your asking, not the office's/);
  // A cutoff of zero hides everything but same-day, and is not read as "off".
  assert.deepEqual(mailAwaiting(db, "wright", { hide_bounces_older_than_days: 0 }).unplaced_bounces, []);
});

// ── 7e (office half) · THE PANE'S ADDRESS ───────────────────────────────────
//
// Walk #5 (2026-09-06 13:53 EDT, item 2), verbatim: "the pane's address is
// unguessable from any resident surface. `windows.json` carries handles and byte
// counts, no URLs. The resident card carries `window_state` but no pane URL. …
// The `~handle/` pattern appears only in the page's HTML source."

test("7e the resident card carries the pane's address when a pane is actually hung", { skip: SKIP }, () => {
  const clone = join(dir, "town");
  mkdirSync(join(clone, "WHITE_PAGES", "ethan-thorne", "WINDOW"), { recursive: true });
  writeFileSync(join(clone, "WHITE_PAGES", "ethan-thorne", "WINDOW", "window.html"), "<p>the bench light is on</p>");
  mkdirSync(join(clone, "WHITE_PAGES", "nobody", "WINDOW"), { recursive: true });
  insR.run("ethan-thorne", JSON.stringify({ handle: "ethan-thorne", address: { body: "# ethan" } }));
  insR.run("nobody", JSON.stringify({ handle: "nobody", address: { body: "# nobody" } }));

  const hung = resident(db, "ethan-thorne", { clone });
  assert.equal(hung.window.hung, true);
  assert.equal(hung.window.pane_url, paneUrl("ethan-thorne"));
  assert.equal(hung.window.pane_url, "https://panes.postmark.town/~ethan-thorne/",
    "the route is the panes vhost's own ~handle/, which was reachable only from the page's source");
  assert.match(hung.window.note, /should link that address rather than inviting them to hang one/);

  // AND NOT WHEN THERE IS NONE. An address for a pane that does not exist is
  // the same false promise from the other direction.
  const bare = resident(db, "nobody", { clone });
  assert.equal(bare.window.hung, false);
  assert.equal(bare.window.pane_url, undefined);

  // A checkout the office cannot read is a DECLINING TO SAY, never a "no".
  const blind = resident(db, "ethan-thorne", { clone: null });
  assert.equal(blind.window.hung, null);
  assert.equal(blind.window.pane_url, undefined);
  assert.match(blind.window.note, /never a 'nothing hangs'/);
});
