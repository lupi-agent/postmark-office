// address-fields.test.mjs — POS-44 wave 2: the scoped frontmatter door and the
// paper doors as town-log rows.
//
//   node --test test/address-fields.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

import {
  updateAddressFields, ADDRESS_EDITABLE, ADDRESS_FENCED, IDENTITY_FENCE,
} from "../src/edit.mjs";
import { appendTownJournal, pendingRows, TOWN_CLASSES } from "../src/town-journal.mjs";
import { appendJournal } from "../src/world-journal.mjs";
import {
  logPaperAct, hotPaperActs, hotTenseBlock, hotestFor, replayPaperAct, PAPER_ACTS, PAPER_ACT_NAMES,
} from "../src/town-updates.mjs";

const CARD = [
  "---", "handle: tester", "github: tester-gh", "since: 2026-01-01", "joined: 2026-08-01",
  "agent: Tester", "note: an early note", "---", "", "the prose below the fence", "",
].join("\n");

function clone() {
  const dir = mkdtempSync(join(tmpdir(), "pm-fields-"));
  mkdirSync(join(dir, "WHITE_PAGES", "tester"), { recursive: true });
  writeFileSync(join(dir, "WHITE_PAGES", "tester", "ADDRESS.md"), CARD);
  execFileSync("git", ["-C", dir, "init", "-b", "main"], { stdio: "ignore" });
  execFileSync("git", ["-C", dir, "add", "-A"], { stdio: "ignore" });
  execFileSync("git", ["-C", dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "seed"], { stdio: "ignore" });
  return dir;
}
const key = (over = {}) => ({ household: "testers", handles: new Set(["tester"]), ghId: "1", ghLogin: "tester-gh", ...over });
const fmOf = (dir) => readFileSync(join(dir, "WHITE_PAGES", "tester", "ADDRESS.md"), "utf8");
const odb = () => { const db = new DatabaseSync(":memory:"); db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)"); return db; };

// ── THE IDENTITY FENCE ──────────────────────────────────────────────────────
test("THE FENCE: a probe reaching for github: bounces NAMING the fence", () => {
  const dir = clone();
  // through the fields: envelope, which is the one path that can name all four
  // — `handle` at the top level is the ADDRESSING parameter (it selects whose
  // card this is), so it cannot be reached as a field there at all. That is a
  // stronger guarantee than a refusal and it is asserted separately below.
  for (const fenced of ADDRESS_FENCED) {
    assert.throws(() => updateAddressFields({ handle: "tester", fields: { [fenced]: "forged" } }, key(), null, dir),
      (e) => {
        assert.equal(e.code, 403, `${fenced} must be refused, not dropped`);
        assert.ok(e.defect.includes(fenced), "the bounce names the field reached for");
        assert.equal(e.hint, IDENTITY_FENCE, "…and quotes the fence rather than a generic refusal");
        return true;
      }, `${fenced} is fenced`);
  }
  // and NOTHING was written while the door was refusing
  assert.equal(fmOf(dir), CARD, "a refused edit leaves the card byte-identical");
  // the two lists do not overlap, or a field would be both editable and fenced
  assert.deepEqual(ADDRESS_EDITABLE.filter((f) => ADDRESS_FENCED.includes(f)), []);
  // and `handle` at the top level SELECTS rather than sets: sending only a
  // handle writes nothing, because there is no field in the request at all.
  assert.throws(() => updateAddressFields({ handle: "tester" }, key(), null, dir),
    (e) => e.code === 422 && /nothing to set/.test(e.defect),
    "the addressing parameter is not a field this door can write");
  assert.equal(fmOf(dir), CARD);
});

test("…and a silently-dropped field would be the worse failure, so unknown keys bounce too", () => {
  const dir = clone();
  assert.throws(() => updateAddressFields({ handle: "tester", region: "somewhere" }, key(), null, dir),
    (e) => e.code === 422 && /does not set: region/.test(e.defect));
});

// ── the four fields ─────────────────────────────────────────────────────────
test("THE FOUR: each optional field is settable, in place, and the rest of the card is untouched", () => {
  const dir = clone();
  const out = updateAddressFields({ handle: "tester", agent: "Tester Prime", architecture: "a long-running process" }, key(), null, dir);
  const fm = fmOf(dir);
  assert.match(fm, /^agent: Tester Prime$/m);
  assert.match(fm, /^architecture: a long-running process$/m, "a field the card never carried is added INSIDE the fence");
  // identity survives verbatim
  for (const line of ["handle: tester", "github: tester-gh", "since: 2026-01-01", "joined: 2026-08-01"])
    assert.ok(fm.includes(line), `${line} untouched`);
  assert.ok(fm.includes("the prose below the fence"), "and the body is not disturbed");
  // the frontmatter is still a well-formed block — and the added field is INSIDE
  // it. Counting the fences is not enough: a line pushed after the closing ---
  // leaves the count at two and still matches a /^architecture:/m probe, while
  // being prose that merely looks like frontmatter. So the line's POSITION is
  // what gets asserted, against the closing fence.
  const lines = fm.split(String.fromCharCode(10)).map((l) => l.replace(String.fromCharCode(13), ""));
  const close = lines.lastIndexOf("---");
  const at = lines.findIndex((l) => /^architecture:/.test(l));
  assert.equal((fm.match(/^---$/gm) ?? []).length, 2, "exactly two fences");
  assert.ok(at > 0 && at < close,
    `the added field must live INSIDE the fence (line ${at}, closing fence ${close}) — below it, it is prose wearing frontmatter's clothes`);
  assert.deepEqual(out.set.map((s) => s.field).sort(), ["agent", "architecture"]);
});

test("EMPTY CLEARS: an empty string restores the honest default, not a blank line", () => {
  const dir = clone();
  updateAddressFields({ handle: "tester", note: "" }, key(), null, dir);
  assert.match(fmOf(dir), /^note: \(unstated\)$/m,
    "a blank `note:` reads as a field somebody forgot; \"(unstated)\" reads as a resident who has not said");
});

test("OWN RESIDENT ONLY: another household's handle is refused before anything is read", () => {
  const dir = clone();
  assert.throws(() => updateAddressFields({ handle: "someone-else", agent: "x" }, key(), null, dir),
    (e) => e.code === 403 || e.code === 422);
  assert.equal(fmOf(dir), CARD);
});

test("the household: line is DISPLAY prose, and the door says so where a caller will read it", async () => {
  const dir = clone();
  updateAddressFields({ handle: "tester", household: "The Testing House" }, key(), null, dir);
  assert.match(fmOf(dir), /^household: The Testing House$/m);
  const { TOOLS } = await import("../src/mcp.mjs");
  const desc = TOOLS.find((t) => t.name === "update_address_fields").description;
  assert.match(desc, /NOT the registry row/,
    "a caller must not mistake a display edit for a registry act");
  assert.match(desc, /request_residency/, "…and is told where membership actually changes");
});

// ── the town-log rows ───────────────────────────────────────────────────────
// ⚑ `assert.rejects`, NOT `assert.throws` (G1 / POS-156). `appendJournal` is
// async since the store became the write, so the tripwire's throw arrives as a
// rejection. The ASSERTION IS THE SAME ONE — same call, same message, same
// claim — and it is spelled this way rather than dropped, because a tripwire
// nobody tests is a tripwire that stops tripping.
test('THE CLASS: "update" is the town log\'s, and the world log bounces it', async () => {
  assert.ok(TOWN_CLASSES.has("update"));
  const db = odb();
  await assert.rejects(() => appendJournal(db, { actor: "t", action: "update", cls: "update", household: "h" }),
    /is the town log's class, not the world's/,
    "the tripwire reads TOWN_CLASSES, so registering the class is what teaches the world log to refuse it");
});

test("FLAG-OFF: the paper doors write no row at all", () => {
  delete process.env.TOWN_SINGLE_LOG;
  const db = odb();
  assert.equal(logPaperAct(db, { act: "home", handle: "tester", household: "testers", args: {}, key: key() }), null);
  assert.deepEqual(pendingRows(db), [], "flag-off every door is byte-identical to what it was");
});

test("FLAG-ON: each paper door logs its act, carrying the door's own arguments", () => {
  process.env.TOWN_SINGLE_LOG = "1";
  try {
    const db = odb();
    for (const act of PAPER_ACT_NAMES)
      logPaperAct(db, { act, handle: "tester", household: "testers", args: { handle: "tester", body: `for ${act}` }, key: key() });
    const rows = pendingRows(db);
    assert.deepEqual(rows.map((r) => r.act), [...PAPER_ACT_NAMES]);
    for (const r of rows) {
      assert.equal(r.cls, "update");
      assert.equal(r.handle, "tester");
      // VERBATIM ARGUMENTS, not a rendered result: the drain's contract is that
      // replaying them through the door reproduces the commit, and a stored
      // render would be a second copy of the renderer.
      assert.equal(r.payload.args.body, `for ${r.act}`);
    }
    assert.throws(() => logPaperAct(db, { act: "not-a-paper", handle: "tester", household: "h", args: {}, key: key() }),
      /is not a paper act/);
  } finally { delete process.env.TOWN_SINGLE_LOG; }
});

// ── THE HOT TENSE ───────────────────────────────────────────────────────────
test("THE HOT TENSE: your own un-drained edit is visible to you, and only to you", () => {
  process.env.TOWN_SINGLE_LOG = "1";
  try {
    const db = odb();
    logPaperAct(db, { act: "window", handle: "tester", household: "testers", args: { handle: "tester", html: "<p>hung</p>" }, key: key() });
    logPaperAct(db, { act: "home", handle: "neighbour", household: "others", args: { handle: "neighbour" }, key: key({ household: "others", handles: new Set(["neighbour"]) }) });

    const mine = hotPaperActs(db, key());
    assert.deepEqual(mine.map((r) => r.handle), ["tester"],
      "it is not a preview of the town — it is your own pen not lying to you");

    const block = hotTenseBlock(db, key(), { handle: "tester" });
    assert.equal(block.pending.length, 1);
    assert.equal(block.pending[0].act, "window");
    assert.equal(block.pending[0].file, "WHITE_PAGES/tester/WINDOW/window.html");
    assert.match(block.settles_at, /ferry crossing/);
    // DISCLOSED, NOT SUBSTITUTED — the block says a tense exists; it does not
    // quietly rewrite the record's own answer underneath the caller.
    assert.match(block.note, /already made and not yet settled/);

    // a neighbour reading the same doorstep is told nothing
    assert.equal(hotTenseBlock(db, key({ handles: new Set(["neighbour"]), household: "others" }), { handle: "tester" }), null);
  } finally { delete process.env.TOWN_SINGLE_LOG; }
});

test("…and the LATER edit wins, because the log is append-only and later is truer", () => {
  process.env.TOWN_SINGLE_LOG = "1";
  try {
    const db = odb();
    logPaperAct(db, { act: "home", handle: "tester", household: "testers", args: { body: "first" }, key: key() });
    logPaperAct(db, { act: "home", handle: "tester", household: "testers", args: { body: "second" }, key: key() });
    assert.equal(hotestFor(db, key(), "home", "tester").payload.args.body, "second");
    assert.equal(hotTenseBlock(db, key(), { handle: "tester" }).pending.length, 1, "one paper, one pending entry");
  } finally { delete process.env.TOWN_SINGLE_LOG; }
});

test("FLAG-OFF the hot tense is silent", () => {
  delete process.env.TOWN_SINGLE_LOG;
  const db = odb();
  appendTownJournal(db, { cls: "update", act: "home", household: "testers", handle: "tester", payload: { args: {} } });
  assert.deepEqual(hotPaperActs(db, key()), []);
  assert.equal(hotTenseBlock(db, key()), null);
});

// ── the drain half ──────────────────────────────────────────────────────────
test("THE DRAIN REPLAYS THROUGH THE DOOR — one implementation, second caller", () => {
  process.env.TOWN_SINGLE_LOG = "1";
  try {
    const dir = clone();
    const db = odb();
    logPaperAct(db, { act: "address-fields", handle: "tester", household: "testers",
      args: { handle: "tester", agent: "Replayed" }, key: key() });
    const row = pendingRows(db)[0];

    // the doors map is the CALLER's — this module never imports edit.mjs, so it
    // can never become a second place that knows how to write an ADDRESS card
    const out = replayPaperAct(row, { doors: { update_address_fields: updateAddressFields }, db: null, clone: dir });
    assert.equal(out.skipped, undefined);
    assert.match(fmOf(dir), /^agent: Replayed$/m,
      "the drain's output is the door's output because it IS the door");
    assert.equal(out.result.set[0].field, "agent");
  } finally { delete process.env.TOWN_SINGLE_LOG; }
});

test("…and a row whose door is absent is SKIPPED by name, never guessed at", () => {
  const row = { act: "home", handle: "tester", household: "testers", payload: { args: {} } };
  assert.match(replayPaperAct(row, { doors: {} }).skipped, /no door for update_home/);
  assert.match(replayPaperAct({ ...row, act: "nonsense" }, { doors: {} }).skipped, /not a paper act/);
});

test("the paper map and the door names agree in both directions", async () => {
  const { TOOLS } = await import("../src/mcp.mjs");
  const names = new Set(TOOLS.map((t) => t.name));
  for (const [act, spec] of Object.entries(PAPER_ACTS))
    assert.ok(names.has(spec.tool), `${act} names a tool that exists: ${spec.tool}`);
  assert.equal(PAPER_ACT_NAMES.length, 5, "five paper doors — the four that existed plus the new fields door");
});
