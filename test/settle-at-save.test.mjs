// settle-at-save.test.mjs — POS-5 §3's finisher: walks and crossings settle at
// the save, not per act to git main.
//
// The ruling (2026-08-22, founder): "walks + enter-exit should settle at the
// save, not per-act to git main."
//
// Until now every walk and every crossing spent ONE GIT COMMIT on world main —
// they were still arriving on main's log the morning this was written
// ("crossing: lucien exits caelum/evermoon (via world_exit)"). Behind
// WORLD_SINGLE_LOG the act writes a journal row instead and the save gives the
// record the same lines, once.
//
// ── THE BAR, AND IT IS THE WHOLE POINT ──────────────────────────────────────
//
// "the record the save writes must carry the same lines the per-act commits
//  would have (fewer commits, identical record content — assert it, not
//  eyeball it)."
//
// So the centrepiece here runs the SAME acts down both lanes and compares the
// resulting ledger BYTE FOR BYTE. Fewer commits is the win; a different record
// would be a bug wearing a win's clothes.
//
// Every test was can-fail flipped; the flips are in the handback.
//
//   node --test test/settle-at-save.test.mjs

import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { openDynamic } from "../src/dynamic-store.mjs";
import { CLASS_FRAME, CLASS_MOVE, readJournal } from "../src/world-journal.mjs";
// ── THE ROWS ARE SEEDED, NOT WRITTEN BY A DOOR (G1 / POS-156) ───────────────
//
// This suite's subject is THE DRAIN: what `world-drain.mjs` makes of a journal
// population. G1 deleted the general journal INSERT, so no door puts rows in
// that table any more -- the write path writes the record instead. The drain
// still reads the table and its retirement is G2's, so it is live code owed
// tests, and the population it reads is now PUT THERE by this file, in the
// office's own row shape. Nothing below claims a door wrote these rows.
import { seedJournalRow } from "./journal-seed.mjs";
import { materializeLedgers } from "../src/world-drain.mjs";

const sweep = (d) => { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } };
const scratch = mkdtempSync(join(tmpdir(), "postmark-settle-"));
after(() => sweep(scratch));

const WALK_LEDGER = "WORLD/walk-ledger.md";
// The passage record, under the name a live journal row actually carries. The
// drain must NOT append to this one — see the filter tests below (#2152).
const ENTER_EXIT_LEDGER = "WORLD/enter-exit-ledger.md";
// And under the retired name, which rows written before the 2026-08-26 rename
// still claim. Both are the same record and both must be filtered out.
const RETIRED_LEDGER = "WORLD/threshold-ledger.md";
const WALK_HEADER = "# Walk ledger\n\nEvery declared departure, in order.\n";
const PASSAGE_HEADER = "# Enter/exit ledger\n\nEvery passage, in order.\n";

let repo, dbPath, n = 0;
beforeEach(() => {
  repo = join(scratch, `w${++n}`);
  mkdirSync(join(repo, "WORLD"), { recursive: true });
  writeFileSync(join(repo, WALK_LEDGER), WALK_HEADER);
  writeFileSync(join(repo, ENTER_EXIT_LEDGER), PASSAGE_HEADER);
  writeFileSync(join(repo, RETIRED_LEDGER), PASSAGE_HEADER);
  dbPath = join(scratch, `dyn-${n}.db`);
  process.env.WORLD_DYNAMIC_DB = dbPath;
  process.env.WORLD_SINGLE_LOG = "1";
});
after(() => { delete process.env.WORLD_DYNAMIC_DB; delete process.env.WORLD_SINGLE_LOG; });

const withDb = (fn) => { const db = openDynamic(dbPath); try { return fn(db); } finally { db.close(); } };

/** A walk row exactly as `walk-exec` writes one under the flag. */
const walkRow = (db, { handle, line, at = 145.1, seq }) => seedJournalRow(db, {
  crossing: at, actor: handle, action: "walk", object: null, cls: CLASS_MOVE,
  at: null, witnesses: null,
  payload: { ledger: WALK_LEDGER, lines: [line], toward: { x: 1, y: 2 }, pace: 60 },
  effect: "the walk is declared; the record receives it at the save",
  writtenAt: `2026-08-24T0${seq ?? 0}:00:00.000Z`,
});

/** A crossing row exactly as `crossing-exec` writes one under the flag. */
const crossRow = (db, { handle, lines, act = "enter", at = 145.2, seq, ledger = ENTER_EXIT_LEDGER }) => seedJournalRow(db, {
  crossing: at, actor: handle, action: act, object: "the-town/town-square", cls: CLASS_FRAME,
  at: null, witnesses: null,
  payload: { ledger, lines, summary: `${act}s the square` },
  effect: "the crossing is declared; the record receives it at the save",
  writtenAt: `2026-08-24T0${seq ?? 0}:00:00.000Z`,
});

const ledger = (name) => readFileSync(join(repo, name), "utf8");

// ── the bar ─────────────────────────────────────────────────────────────────

test("THE BAR — the save's record is BYTE-IDENTICAL to what the per-act commits would have written", () => {
  //   "the record the save writes must carry the same lines the per-act commits
  //    would have (fewer commits, identical record content — assert it, not
  //    eyeball it)."
  //
  // THE PER-ACT LANE, reproduced exactly: read, append, write — once per act,
  // which is where the commits came from.
  const perAct = join(scratch, `per-act-${n}`);
  mkdirSync(join(perAct, "WORLD"), { recursive: true });
  writeFileSync(join(perAct, WALK_LEDGER), WALK_HEADER);
  const lines = [
    "- 2026-08-24T01:00:00Z · lucien · from -10,-10 · toward 40,40 · at 145.10",
    "- 2026-08-24T02:00:00Z · ember · from 0,0 · toward 5,5 · at 145.11",
    "- 2026-08-24T03:00:00Z · lucien · from 40,40 · toward 41,41 · at 145.12",
  ];
  for (const line of lines) {
    const prev = readFileSync(join(perAct, WALK_LEDGER), "utf8");
    const sep = prev.endsWith("\n") ? "" : "\n";
    writeFileSync(join(perAct, WALK_LEDGER), `${prev}${sep}${line}\n`, "utf8");
  }

  // THE SAVE LANE: the same three acts declared into the journal, materialized once.
  withDb((db) => lines.forEach((line, i) => walkRow(db, { handle: "x", line, seq: i + 1 })));
  const rows = withDb((db) => readJournal(db));
  const wrote = materializeLedgers(repo, rows);

  assert.equal(ledger(WALK_LEDGER), readFileSync(join(perAct, WALK_LEDGER), "utf8"),
    "byte for byte — the same record, arrived by a different road");
  assert.deepEqual(wrote, [{ ledger: WALK_LEDGER, appended: 3 }],
    "and it took ONE write where the per-act lane took three");
});

// ── THE SECOND PEN, REMOVED (#2152) ─────────────────────────────────────────
//
// This loop used to route passage rows into the committed enter/exit files too,
// and it was one of the two office pens that put live-era lines into a file the
// world repo's own law says must equal the frozen era exactly — quoted verbatim
// from `tools/enter-exit-record.test.mjs` over there:
//
//     "the world repo has no journal to read — a longer derived file means a
//      hand wrote in it"
//
// Every append turned the world's grammar suite red, which cost the settlement
// sweep its ability to attribute a failure to a candidate and refused the whole
// crossing. Three hand-repairs on world main before the pens were found.
//
// The passages are not lost by this: they are in the journal, and the office
// door derives the live era on every read. The walk ledger keeps its pen,
// because it has no deriver — this loop is its only writer and that is lawful.

test("THE FILTER — a passage row leaves the committed enter/exit file BYTE-UNCHANGED", () => {
  const before = ledger(ENTER_EXIT_LEDGER);
  withDb((db) => {
    crossRow(db, { handle: "lucien", lines: ["- c1 · lucien enters"], seq: 1 });
    crossRow(db, { handle: "lucien", lines: ["- c2 · lucien exits"], act: "exit", seq: 2 });
  });
  const wrote = materializeLedgers(repo, withDb((db) => readJournal(db)));

  assert.equal(ledger(ENTER_EXIT_LEDGER), before,
    "the drain appended a passage to a DERIVED file — this is the bug the whole lane exists to close");
  assert.deepEqual(wrote, [], "and it did not report writing one either");
});

test("THE FILTER — a row under the RETIRED name is filtered too, and the retired file is byte-unchanged", () => {
  // Rows written before the 2026-08-26 rename name `WORLD/threshold-ledger.md`
  // in their payload. They are the same record; a filter that knew only the new
  // name would let every pre-rename row through.
  const before = ledger(RETIRED_LEDGER);
  withDb((db) => crossRow(db, { handle: "sable", lines: ["- old name, same record"], seq: 1, ledger: RETIRED_LEDGER }));
  const wrote = materializeLedgers(repo, withDb((db) => readJournal(db)));

  assert.equal(ledger(RETIRED_LEDGER), before);
  assert.deepEqual(wrote, []);
});

test("THE FILTER IS EXPLICIT, not an accident of a missing file", () => {
  // The drain has a "no such ledger in this clone — nothing appended" branch,
  // and it would have looked like a fix on a clone where the file is absent. A
  // production clone HAS the file, which is how the appends happened at all. So
  // the filter is asserted against a clone where the file is present AND
  // writable — if it were load-bearing on absence, this is the case that fails.
  assert.ok(existsSync(join(repo, ENTER_EXIT_LEDGER)), "the file is here, so absence cannot be what is protecting it");
  withDb((db) => crossRow(db, { handle: "alta", lines: ["- a passage"], seq: 1 }));
  const wrote = materializeLedgers(repo, withDb((db) => readJournal(db)));
  assert.deepEqual(wrote, [], "no skip note either — the rows never reached the routing at all");
});

test("THE DISCRIMINATOR — the walk ledger still gets its lines, in the same pass", () => {
  // The whole risk of this cut is over-reaching. The walk ledger has no deriver;
  // this loop is its only pen and removing it would strand every departure.
  withDb((db) => {
    walkRow(db, { handle: "lucien", line: "- w1 · lucien", seq: 1 });
    crossRow(db, { handle: "lucien", lines: ["- c1 · lucien enters"], seq: 2 });
    walkRow(db, { handle: "ember", line: "- w2 · ember", seq: 3 });
    crossRow(db, { handle: "lucien", lines: ["- c2 · lucien exits"], act: "exit", seq: 4 });
  });
  const passagesBefore = ledger(ENTER_EXIT_LEDGER);
  const wrote = materializeLedgers(repo, withDb((db) => readJournal(db)));

  assert.equal(ledger(WALK_LEDGER), `${WALK_HEADER}- w1 · lucien\n- w2 · ember\n`);
  assert.deepEqual(wrote, [{ ledger: WALK_LEDGER, appended: 2 }]);
  assert.equal(ledger(WALK_LEDGER).includes("enters"), false, "a crossing never lands in the walk ledger");
  assert.equal(ledger(ENTER_EXIT_LEDGER), passagesBefore, "and the passages went nowhere on disk");
});

test("IN SEQ ORDER — a ledger the drain still writes takes its lines in seq order", () => {
  // The walk ledger is an append-only record of a SEQUENCE, and the journal's
  // own order is the order the acts happened in. The rows are deliberately
  // appended out of clock order here to prove the seq is what decides.
  withDb((db) => {
    walkRow(db, { handle: "lucien", line: "- sets out", at: 145.9, seq: 1 });
    walkRow(db, { handle: "lucien", line: "- sets out again", at: 145.1, seq: 2 });
  });
  materializeLedgers(repo, withDb((db) => readJournal(db)));
  const body = ledger(WALK_LEDGER);
  assert.ok(body.indexOf("sets out\n") < body.indexOf("sets out again"),
    "seq decides, not the crossing stamp — a record out of order is a record that cannot be read");
});

test("IDEMPOTENT — materializing twice appends nothing twice", () => {
  // The drain's whole crash story rests on every step before the truncate being
  // re-runnable (the-atomic-drain). A ledger appended twice on a replay would be
  // a record the crossing invented.
  withDb((db) => walkRow(db, { handle: "lucien", line: "- once and only once", seq: 1 }));
  const rows = withDb((db) => readJournal(db));
  materializeLedgers(repo, rows);
  const after = ledger(WALK_LEDGER);
  const again = materializeLedgers(repo, rows);
  assert.equal(ledger(WALK_LEDGER), after, "the second pass changes nothing");
  assert.deepEqual(again, [{ ledger: WALK_LEDGER, appended: 0, already: 1 }],
    "and it says so rather than silently doing nothing");
});

test("A MISSING LEDGER IS NAMED, never invented", () => {
  // The ledgers are founding files with their own headers. A save that created
  // one would produce a headerless file the parsers refuse — so a clone that is
  // not the world these lines belong to gets a named skip, not a new file.
  rmSync(join(repo, WALK_LEDGER));
  withDb((db) => walkRow(db, { handle: "lucien", line: "- into the void", seq: 1 }));
  const wrote = materializeLedgers(repo, withDb((db) => readJournal(db)));
  assert.equal(existsSync(join(repo, WALK_LEDGER)), false, "no file was invented");
  assert.equal(wrote[0].appended, 0);
  assert.equal(wrote[0].skipped, 1);
  assert.match(wrote[0].note, /no such ledger/);
});

test("ROWS THAT OWE NO LINE ARE UNTOUCHED — a mark row is not a ledger row", () => {
  // The rule is payload-shaped, not class-shaped: any row carrying
  // `ledger` + `lines` is materialized, and every other row is the drain's
  // other business. A mark row has neither.
  withDb((db) => {
    seedJournalRow(db, { crossing: 145, actor: "alpha", action: "leave-mark", object: "alpha/x",
      cls: "mark", at: null, witnesses: null, payload: { slug: "x", by: "alpha", body: "a mark" } });
    walkRow(db, { handle: "lucien", line: "- the only line", seq: 2 });
  });
  const wrote = materializeLedgers(repo, withDb((db) => readJournal(db)));
  assert.deepEqual(wrote, [{ ledger: WALK_LEDGER, appended: 1 }]);
  assert.equal(ledger(WALK_LEDGER), `${WALK_HEADER}- the only line\n`);
});

// ── the flag ────────────────────────────────────────────────────────────────

/**
 * A world clone just real enough to run the walk pen: the ledger, a git repo
 * (penCommit needs one), and the clone's own `walk.mjs` — the real arithmetic,
 * transcribed, because what is under test is the PEN's two lanes and not the
 * town's physics.
 */
function walkClone(label) {
  const clone = join(scratch, `clone-${label}-${n}`);
  mkdirSync(join(clone, "WORLD"), { recursive: true });
  mkdirSync(join(clone, "tools"), { recursive: true });
  writeFileSync(join(clone, WALK_LEDGER.replace("WORLD/", "WORLD/")), WALK_HEADER);
  writeFileSync(join(clone, "tools", "walk.mjs"), [
    'export const CROSSING_EPOCH_UTC = Date.UTC(2026, 5, 12);',
    'export const CROSSING_MS = 12 * 3600 * 1000;',
    'export const WALK_KM_PER_CROSSING = 15;',
    'export function fractionalCrossing(ms = Date.now()) { return Math.max(0, (ms - CROSSING_EPOCH_UTC) / CROSSING_MS); }',
    'export function formatDeparture({ handle, from, toward, at }) {',
    '  return `- FIXED · ${handle} · from ${from.x},${from.y} · toward ${toward.x},${toward.y} · at ${at.toFixed(5)}`;',
    '}',
    'export function parseWalkLedger(text) {',
    '  const departures = []; const unrecognized = [];',
    '  for (const raw of String(text ?? "").split("\\n")) {',
    '    if (!raw.startsWith("- ")) continue;',
    '    const m = raw.match(/^- (\\S+) · (\\S+) · from (-?[\\d.]+),(-?[\\d.]+) · toward (-?[\\d.]+),(-?[\\d.]+) · at ([\\d.]+)$/);',
    '    if (!m) { unrecognized.push(raw); continue; }',
    '    departures.push({ handle: m[2], from: { x: +m[3], y: +m[4] }, toward: { x: +m[5], y: +m[6] }, at: +m[7] });',
    '  }',
    '  return { departures, unrecognized };',
    '}',
    'export function positionAt(dep, at) {',
    '  if (!dep) return { x: 0, y: 0, legM: 0, etaCrossings: 0, standing: true };',
    '  return { x: dep.toward.x, y: dep.toward.y, legM: 1, etaCrossings: 0, standing: true };',
    '}',
  ].join("\n"));
  const g = (...a) => execFileSync("git", ["-C", clone, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  g("init", "-q", "-b", "main");
  g("config", "user.name", "fixture");
  g("config", "user.email", "fixture@test.invalid");
  g("add", "-A");
  g("commit", "-q", "-m", "a world with a ledger");
  return { clone, g };
}

/** Run the walk pen as the office runs it: a subprocess, one JSON line out. */
function runWalk(clone, payload, env) {
  const out = execFileSync(process.execPath, [new URL("../src/walk-exec.mjs", import.meta.url).pathname.replace(/^\//, ""), JSON.stringify(payload)], {
    encoding: "utf8",
    env: { ...process.env, WORLD_CLONE: clone, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out.trim().split("\n").at(-1));
}

test("END TO END — the same three walks, both lanes, and the ledger comes out BYTE-IDENTICAL", () => {
  //   "flag off = per-act writes stand (prod unchanged); flag on = journal now,
  //    record at the save" … "fewer commits, identical record content — assert
  //    it, not eyeball it."
  //
  // This is that assertion at the door rather than at the helper: the real pen,
  // as a subprocess, down both lanes, over the same three walks.
  const walks = [
    { handle: "lucien", from: { x: -10, y: -10 }, toward: { x: 40, y: 40 }, at: 145.1 },
    { handle: "ember", from: { x: 0, y: 0 }, toward: { x: 5, y: 5 }, at: 145.11 },
    { handle: "lucien", from: { x: 40, y: 40 }, toward: { x: 41, y: 41 }, at: 145.12 },
  ];

  // ── the per-act lane: a commit apiece, which is what the ruling retires ────
  const off = walkClone("off");
  const commits = [];
  for (const w of walks) {
    const r = runWalk(off.clone, w, { WORLD_SINGLE_LOG: "" });
    assert.ok(r.commit, "flag off still spends a commit — prod behaviour, unchanged");
    assert.equal(r.log, undefined, "and says nothing about a journal it never used");
    commits.push(r.commit);
  }
  assert.equal(new Set(commits).size, 3, "three acts, three commits — the cost being removed");

  // ── the save lane, AFTER G1: the door needs a record, and says so ─────────
  //
  // This half used to assert `commit: null`, `log: "journal"` and "settles at
  // the save" from the real pen down the flag-on lane. G1 (POS-156, RULING 3)
  // made the write AWAITED and REFUSABLE — "the store is the write" — so a
  // subprocess pointed at no record no longer files a row nobody reads: it
  // gives the ruled 503, which is the whole point of the ruling.
  //
  // This runs as a SUBPROCESS, so the in-memory pen (`test/acts-pen-stub.mjs`)
  // cannot reach it; a record here would mean a live Postgres. So what is
  // asserted end to end is the new truth — the refusal — and the assertion this
  // test used to carry NAMES ITS NEW HOME rather than being dropped:
  //
  //   "fewer commits, identical record content" is held by THE BAR, the first
  //   test in this file, which runs `materializeLedgers` over the same three
  //   walks and compares the two records byte for byte. It is the same claim on
  //   the same subject (the drain), one process in.
  const on = walkClone("on");
  const dbFor = join(scratch, `e2e-${n}.db`);
  for (const w of walks) {
    const r = runWalk(on.clone, w, { WORLD_SINGLE_LOG: "1", WORLD_DYNAMIC_DB: dbFor });
    assert.equal(r.error?.code, 503,
      "an office pointed at no record must REFUSE a walk, not answer 200 over an act no store holds");
    assert.match(String(r.error?.hint), /the office's record/,
      "and the refusal says the record is what could not be reached");
  }
  assert.equal(readFileSync(join(on.clone, WALK_LEDGER), "utf8"), WALK_HEADER,
    "nothing was written anywhere — a refusal leaves the record exactly as it was");

  // POS-269: the walk door no longer opens the dynamic store at all, so the
  // strongest form of "nothing reached the sqlite journal" is that there is no
  // file for it to have reached.
  assert.equal(existsSync(dbFor), false,
    "and NO sqlite store was even created — G1 deleted the INSERT and POS-269 the open, so a refused walk has no consolation copy");
});

test("FLAG OFF — materializing is a no-op when nothing declared itself into the journal", () => {
  const before = ledger(WALK_LEDGER);
  const wrote = materializeLedgers(repo, []);
  assert.deepEqual(wrote, [], "no rows, no ledgers touched");
  assert.equal(ledger(WALK_LEDGER), before, "and the record is byte-identical");
});

// ── §5 · the cold archive, wired at the save ────────────────────────────────
//
//   "tools/state-to-r2.mjs is proven and UNWIRED (§5's condition: it wires at
//    the save, not on its own timer). Small: the crossing-save calls it after a
//    green write-down; a failed upload is DISCLOSED, never blocks the save (the
//    record is git-truth; R2 is a mirror)."

test("§5 — the archive FIRES at the save, after the write-down, with the save's own repo", async () => {
  const { archiveToR2 } = await import("../src/world-drain.mjs");
  const calls = [];
  const r = await archiveToR2({
    repo: "/a/world", stateDir: "/a/world/STATE",
    run: async (ctx) => { calls.push(ctx); return { uploaded: 3, skipped: 1 }; },
  });
  assert.equal(calls.length, 1, "wired — it runs, once");
  assert.equal(calls[0].repo, "/a/world", "against the repo the save just wrote");
  assert.equal(calls[0].stateDir, "/a/world/STATE");
  assert.equal(r.archived, true);
  assert.equal(r.uploaded, 3, "and the archiver's own report rides back");
});

test("§5 — A FAILED UPLOAD IS DISCLOSED AND DOES NOT BLOCK: the record is git-truth, R2 is a mirror", async () => {
  const { archiveToR2 } = await import("../src/world-drain.mjs");
  const r = await archiveToR2({
    repo: "/a/world",
    run: async () => { throw new Error("bucket unreachable: 503 from r2"); },
  });
  assert.equal(r.archived, false, "it says the mirror is behind");
  assert.match(r.reason, /bucket unreachable/, "and names why, rather than swallowing it");
  assert.match(r.note, /git-truth/, "and says which of the two is the record");
  assert.match(r.note, /nothing here needs re-running/,
    "so an operator is not told to re-run a settlement whose work is already on disk");
});

// The seam's DEFAULT-OFF is guarded behaviourally by test/world-drain.test.mjs:
// twenty-five cases call `drain()` and not one of them reaches for a bucket or
// spawns the archiver. If the default were "spawn the tool", that suite would
// either hang on a network or scribble on a real bucket — so its being green
// and fast IS the assertion, and a second one here that never reached the line
// would have been decoration. (It was: an earlier version of this test drove a
// drain with an empty journal, which returns before the archive is ever
// considered. The can-fail flip caught it.)

test("THE WALK SAYS WHICH PACE IT WALKED AT: on the floor, the engine's legacy constant, named; on the world, the resident class's dial (POS-270 lane W 3b)", () => {
  // The 2026-08-22 slow-walk class: a walk at the legacy constant that reads
  // like one at the law's pace. With world.db retired, a walk pen that cannot
  // read the world graph is exactly that walk, so its own answer says so.
  const floor = walkClone("pace-floor");
  const onFloor = runWalk(floor.clone, { handle: "lucien", from: { x: 0, y: 0 }, toward: { x: 9, y: 9 }, at: 145.2 }, { WORLD_SINGLE_LOG: "", WORLD_GRAPH_ROWS: "" });
  assert.equal(onFloor.dial_fallback, true);
  assert.equal(onFloor.pace_walked, 15, "the floor walk must name the constant it actually walked at");
  assert.match(onFloor.pace_source, /legacy constant/);

  const world = walkClone("pace-world");
  const rows = join(world.clone, "..", "pace-world-rows.json");
  writeFileSync(rows, JSON.stringify({
    meta: [{ key: "hydration_status", value: "OK" }, { key: "as_of_world", value: "pacefixture" }],
    nodes: [{ id: "the-town/resident", kind: "mark", subkind: "sited", tier: "constitution", by: "the-town", at_x: 0, at_y: 0, extent_w: 1, extent_h: 1,
      props: JSON.stringify({ class: "resident", in_works: 1, dials: { pace_km_per_crossing: 60 } }) }],
    edges: [], events: [], geometryVersions: [], lintFindings: [],
  }));
  const onWorld = runWalk(world.clone, { handle: "lucien", from: { x: 0, y: 0 }, toward: { x: 9, y: 9 }, at: 145.2 }, { WORLD_SINGLE_LOG: "", WORLD_GRAPH_ROWS: rows });
  assert.equal(onWorld.dial_fallback, undefined);
  assert.equal(onWorld.pace_walked, 60);
  assert.match(onWorld.pace_source, /resident class's dial/);
});
