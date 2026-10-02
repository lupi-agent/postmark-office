// next-crossing.test.mjs — the next crossing's time on the doorstep and on the
// send receipt, so a writer knows whether a letter makes this crossing or the
// next (postmark#2922).
//
// THE FALSIFIER THE ISSUE NAMES: a receipt minted at T names the FIRST crossing
// after T. Pinned as a property over a sweep of instants, not at three hand-
// picked times, because the wrong derivations (the crossing after next, the
// current interval's start, a boat on the settlement's clock) all agree with
// the right one at SOME instants and never at all of them.
//
// THE FLIP, run 2026-09-18 against commit `bba0361` of this branch:
// in src/crossings.mjs § nextCrossingAt, `currentCrossing(n) + 1` → `+ 2` —
// the doorstep and every receipt name the crossing AFTER next — and the
// property below reds on the first instant ("named a crossing that is not the
// first after T"); the equality with write.mjs's `nextCrossing` reds with it,
// since the two are one derivation now.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

import { CROSSING_EPOCH_UTC, CROSSING_MS, currentCrossing, nextCrossingAt, nextCrossingBlock, nextCrossingForDoorstep, nextCrossingForReceipt } from "../src/crossings.mjs";
import { enqueueLetter, nextCrossing } from "../src/write.mjs";
import { sendLetterAsRow, duplicateReceipt } from "../src/town-mail.mjs";
import { doorstepBundle } from "../src/doorstep-bundle.mjs";
import { fixtureDb, tempClone, fixtureKey } from "./fixture.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";

delete process.env.TOWN_PUSH;
const HOUR = 3600 * 1000;
const onTheBeat = (iso) => { const d = new Date(iso); return d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0 && (d.getUTCHours() === 0 || d.getUTCHours() === 12); };

// The doors below run in this process and read their town index from a store
// seeded from this fixture (POS-268, office-under-test.mjs).
const IX = await indexStore(fixtureDb());
const IX_RESTORE = await IX.useInProcess();
test.after(async () => { await IX_RESTORE(); await IX.stop(); });

test("THE PROPERTY · for every instant T, the receipt's crossing is the FIRST 00:00Z/12:00Z strictly after T", () => {
  const start = Date.parse("2026-09-17T00:00:00Z");
  let checked = 0;
  for (let t = start; t < start + 3 * 24 * HOUR; t += 7 * 60 * 1000 + 13) {   // every 7m13s across three days — lands on and off every beat
    const at = Date.parse(nextCrossingAt(t));
    assert.ok(at > t, `named a crossing at or before T (${new Date(t).toISOString()} → ${new Date(at).toISOString()})`);
    assert.ok(onTheBeat(new Date(at).toISOString()), "a crossing is a 00:00Z or 12:00Z beat");
    assert.ok(at - t <= 12 * HOUR, `named a crossing that is not the first after T (${new Date(t).toISOString()} → ${new Date(at).toISOString()})`);
    checked += 1;
  }
  assert.ok(checked > 500, "the sweep ran");
  // and exactly ON a beat, the next one is the next one — not this one
  assert.equal(nextCrossingAt(Date.parse("2026-09-18T12:00:00Z")), "2026-09-19T00:00:00.000Z");
});

test("the boat's NUMBER is the ratified derivation's — crossing N lands at epoch + N × 12h; crossing 100 lands 2026-08-01T00:00Z", () => {
  assert.equal(new Date(CROSSING_EPOCH_UTC + 100 * CROSSING_MS).toISOString(), "2026-08-01T00:00:00.000Z");
  for (const iso of ["2026-09-18T03:50:00Z", "2026-09-18T12:00:00Z", "2026-09-18T23:59:59Z"]) {
    const b = nextCrossingBlock(Date.parse(iso));
    assert.equal(Date.parse(b.at), CROSSING_EPOCH_UTC + b.crossing * CROSSING_MS, "the number and the instant are one derivation");
    assert.equal(b.crossing, currentCrossing(Date.parse(iso)) + 1, "the next boat is the one after the current interval");
  }
  assert.equal(nextCrossingBlock(Date.parse("2026-09-18T03:50:00Z")).crossing, 197);
});

test("ONE CLOCK · write.mjs's nextCrossing is crossings.mjs's nextCrossingAt, for a Date and for a number", () => {
  for (const iso of ["2026-07-07T13:30:00Z", "2026-07-07T03:00:00Z", "2026-07-07T00:00:00Z", "2026-12-31T23:59:59Z"]) {
    assert.equal(nextCrossing(new Date(iso)), nextCrossingAt(Date.parse(iso)));
    assert.equal(nextCrossing(new Date(iso)), nextCrossingAt(iso));
  }
});

test("minutes_away is a ceiling and never 0 — a reader at 11:59:30Z is told 1", () => {
  assert.equal(nextCrossingBlock(Date.parse("2026-09-18T11:59:30Z")).minutes_away, 1);
  assert.equal(nextCrossingBlock(Date.parse("2026-09-18T11:30:00Z")).minutes_away, 30);
  assert.equal(nextCrossingBlock(Date.parse("2026-09-18T00:00:00Z")).minutes_away, 720);
});

test("the two sentences: the doorstep's is read before writing; the receipt's names the boat and, for a letter standing past its own boat, says it has sailed", () => {
  const d = nextCrossingForDoorstep(Date.parse("2026-09-18T11:30:00Z"));
  assert.deepEqual(Object.keys(d), ["crossing", "at", "sentence"], "no minute counter on the page — it rides the receipt (see crossings.mjs § nextCrossingForDoorstep)");
  assert.equal(d.sentence, "crossing 197 sails at 2026-09-18T12:00:00.000Z. A letter written before then rides it; one written after goes on the crossing after.");
  const r = nextCrossingForReceipt(Date.parse("2026-09-18T11:30:00Z"));
  assert.equal(r.sentence, "sails at the next crossing, 2026-09-18T12:00:00.000Z — crossing 197, 30 minutes away");
  // written at 11:00Z, read back at 12:30Z, still standing: the 12:00Z boat it was told about has sailed
  const late = nextCrossingForReceipt(Date.parse("2026-09-18T12:30:00Z"), { writtenAt: "2026-09-18T11:00:00Z" });
  assert.equal(late.sentence, "this crossing has sailed (2026-09-18T12:00:00.000Z); yours goes at 2026-09-19T00:00:00.000Z — crossing 198, 690 minutes away");
  // written at 11:00Z and read back at 11:45Z: the same boat, the ordinary sentence
  const soon = nextCrossingForReceipt(Date.parse("2026-09-18T11:45:00Z"), { writtenAt: "2026-09-18T11:00:00Z" });
  assert.match(soon.sentence, /^sails at the next crossing, 2026-09-18T12:00:00\.000Z/);
});

// ── the receipts, through the doors ─────────────────────────────────────────

test("flag-off · enqueueLetter's receipt carries next_crossing beside expected_crossing, naming ONE boat", () => {
  const db = fixtureDb();
  const clone = tempClone();
  try {
    const r = enqueueLetter({ from: "wright", to: "limen", title: "the boat", thread: "new", body: "Limen —\n\nwhich boat?" }, fixtureKey, db, clone);
    assert.equal(typeof r.expected_crossing, "string", "the frozen key stays");
    assert.equal(r.next_crossing.at, r.expected_crossing, "one boat, two spellings");
    assert.ok(Date.parse(r.next_crossing.at) > Date.now());
    assert.equal(r.next_crossing.crossing, currentCrossing() + 1);
    assert.match(r.next_crossing.sentence, /^sails at the next crossing, /);
    assert.ok(r.next_crossing.minutes_away >= 1);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

/** A town clone the envelope pre-flight can scan (the foyer suite's own shape). */
function mailClone() {
  const d = mkdtempSync(join(tmpdir(), "pm-next-crossing-town-"));
  for (const h of ["wright", "limen"]) {
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
const logDb = () => { const d = new DatabaseSync(":memory:"); d.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)"); return d; };
const KEY = { household: "keemin", handles: new Set(["wright"]), ghId: "42", ghLogin: "keeminlee" };

test("flag-on · the town-log receipt carries next_crossing too, and the duplicate receipt's sentence turns on the row's own written_at", async () => {
  process.env.TOWN_SINGLE_LOG = "1";
  const odb = logDb();
  const clone = mailClone();
  try {
    const db = fixtureDb();
    const r = await sendLetterAsRow({ from: "wright", to: "limen", title: "the boat", thread: "new", body: "Limen —\n\nwhich boat?" }, KEY, db, clone, odb);
    assert.equal(r.next_crossing.at, r.expected_crossing);
    assert.match(r.next_crossing.sentence, /^sails at the next crossing, /);
    // a duplicate receipt for a row written before a boat that has since sailed
    const stale = duplicateReceipt({ seq: 1, payload: { id: r.letter_id }, writtenAt: new Date(Date.now() - 13 * HOUR).toISOString() }, "n-1");
    assert.equal(stale.next_crossing.at, stale.expected_crossing);
    assert.match(stale.next_crossing.sentence, /^this crossing has sailed \(/);
    // and one written a minute ago names the boat ahead in the ordinary words
    const fresh = duplicateReceipt({ seq: 1, payload: { id: r.letter_id }, writtenAt: new Date(Date.now() - 60000).toISOString() }, "n-2");
    assert.match(fresh.next_crossing.sentence, /^sails at the next crossing, /);
  } finally {
    delete process.env.TOWN_SINGLE_LOG;
    odb.close();
    rmSync(clone, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

// ── the doorstep header ─────────────────────────────────────────────────────

test("the doorstep carries next_crossing right under as_of, on both skins — the same number the receipt will name", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pm-next-crossing-"));
  const dbPath = join(dir, "fixture.db");
  fixtureDb(dbPath).close();
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const meta = { as_of: "fixturesha000000000000000000000000000000" };
    const ctx = { db, key: null, meta, asOf: meta.as_of, canWrite: false, clone: null, pen: null, odb: null, dbPath: null };
    for (const slim of [false, true]) {
      const d = await doorstepBundle("wright", { ...ctx, slim });
      assert.deepEqual(Object.keys(d).slice(0, 3), ["handle", "as_of", "next_crossing"], "the header, in reading order");
      assert.equal(d.next_crossing.crossing, currentCrossing() + 1);
      assert.equal(d.next_crossing.at, nextCrossingAt());
      assert.match(d.next_crossing.sentence, /^crossing \d+ sails at .* A letter written before then rides it/);
      assert.equal(d.next_crossing.minutes_away, undefined, "the page carries no minute counter — two doors, one answer");
      assert.ok(!d.segments.includes("next_crossing"), "a header field, not a segment — no other read serves it");
    }
  } finally { db.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});
