// standing-store.test.mjs — the standing ledger is a store table, the town's
// file is its export, and the Registrar writes through one office act (POS-347).
//
//   node --test test/standing-store.test.mjs
//
// ── WHAT IS ON TRIAL ────────────────────────────────────────────────────────
//
//   BACKFILL   the first drain adopts every line of the town's file, in file
//              order (source `git`), and the store then renders the file byte
//              for byte: `--check` is equal.
//   GIT IN     a line committed to the file by hand afterwards is adopted at
//              the next drain (the store reads git), and named in the commit.
//   NO DROP    a line the grammar cannot read is never adopted and never
//              dropped: the drain refuses, naming it, and nothing changes.
//   NO DELETE  a hand edit that removes a line is undone by the next render:
//              the store never forgets an act.
//   APPEND     060's trigger refuses UPDATE and DELETE, for the owner too.
//   THE DOOR   the Registrar's act appends a row and renders the file in one
//              commit; revoke without the founder's word, a no-op lift and a
//              non-resident are refused and write nothing; a retry after a
//              lost push resumes instead of doubling the act; and the gate
//              reads the new row at the next call.
//   UNLISTED   to a key that is not the Registrar's (or wright's) the act
//              answers as a name the household door has never heard of.
//
// ── THE FLIPS (run after the commit; the red lines go in the report) ────────
//
//   1. drainStanding skips adoptFromGit: BACKFILL goes red (the render drops
//      every line the file held).
//   2. judgeAgainstRecord skips the lift check: the no-op lift is written.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { startStore } from "./helpers/embedded-store.mjs";
import { __setPoolForTest } from "../src/world2-acts.mjs";
import { STANDING_LEDGER_PATH, standingBounce } from "../src/standing.mjs";
import { loadStandingActs } from "../src/standing-store.mjs";
import { checkStanding, drainStanding } from "../tools/standing-drain.mjs";
import { standingUnderLock, judgeStandingFields, callerMayStand, STANDING_CALLERS } from "../src/standing-door.mjs";
import { householdApex } from "../src/household-apex.mjs";
import { resetStanding } from "./helpers/standing-rows.mjs";

const store = await startStore({ db: "standing_store_test" });
process.env.WORLD2_PG = "1";
process.env.WORLD2_PG_URL = store.url("office_api");
delete process.env.TOWN_PUSH;

const trash = [];
after(async () => {
  __setPoolForTest(null);
  await store.stop();
  for (const d of trash) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

// The real file's shape: its header prose above the first act, then the acts.
const HEADER = `# standing-ledger — the Registrar's audit, witnessed

Machine-first, append-only, single-writer (the Registrar).

---

`;
const L1 = "- 2026-09-04 · quarantine · wesley-seeker · by: registrar · reason: The ADDRESS names Wesley Seeker, but its public card is a draft; identity is not presently clear.";
const L2 = "- 2026-09-09 · lift · wesley-seeker · by: registrar · reason: Founder-approved rename now projects Eloise Stellanova; the earlier identity mismatch is resolved.";
const L3 = "- 2026-09-12 · quarantine · loki · by: registrar · reason: Two same-day settled records name the agent Loki; their distinct resident identities are not presently clear.";

const git = (dir, ...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();

function townClone(ledger) {
  const dir = mkdtempSync(join(tmpdir(), "pm-standing-store-"));
  trash.push(dir);
  mkdirSync(join(dir, "tools"), { recursive: true });
  if (ledger !== null) writeFileSync(join(dir, STANDING_LEDGER_PATH), ledger);
  git(dir, "init", "-q");
  git(dir, "add", "-A");
  git(dir, "-c", "user.name=fixture", "-c", "user.email=f@t.invalid", "commit", "-q", "--allow-empty", "-m", "fixture town");
  return dir;
}

const readLedger = (dir) => readFileSync(join(dir, STANDING_LEDGER_PATH), "utf8");

/** A commit capture: what the pen would have committed, without a pen. */
const capture = () => {
  const made = [];
  const fn = (clone, paths, message) => { made.push({ paths, message }); return `sha${made.length}`; };
  fn.made = made;
  return fn;
};

async function residents(...handles) {
  const c = await store.connect("office_api");
  try {
    await c.query("DELETE FROM households WHERE slug = 'standing-fixture'").catch(() => {});
    await c.query(
      `INSERT INTO households (slug, ord, name, residents, since, declared_by) VALUES ('standing-fixture', 9001, 'Fixture', $1, '2026-09-01', 'fixture')
       ON CONFLICT (slug) DO UPDATE SET residents = EXCLUDED.residents`, [handles]);
  } finally { await c.end(); }
}

test("BACKFILL: the first drain adopts the file in order, and the store then renders it byte for byte", async () => {
  await resetStanding(store);
  const original = HEADER + [L1, L2, L3].join("\n") + "\n";
  const clone = townClone(original);

  const before = await checkStanding({ clone });
  assert.equal(before.missing.length, 3, "--check names the three lines the store does not hold yet");

  const commit = capture();
  const r = await drainStanding({ clone, commit });
  assert.equal(r.ran, true);
  assert.deepEqual(r.adopted.map((a) => a.line), [L1, L2, L3], "adopted in file order");
  assert.equal(r.changed, false, "the store renders exactly the file it adopted, so nothing is written");
  assert.equal(commit.made.length, 0);

  const rows = await loadStandingActs();
  assert.deepEqual(rows.map((x) => x.source), ["git", "git", "git"]);
  assert.ok(rows[0].id < rows[1].id && rows[1].id < rows[2].id, "the ids keep the file's order");

  const after = await checkStanding({ clone });
  assert.equal(after.equal, true, "--check: byte-equal");
  assert.equal(readLedger(clone), original);
});

test("GIT IN: a line committed to the file by hand is adopted at the next drain", async () => {
  await resetStanding(store);
  const clone = townClone(HEADER + L1 + "\n");
  await drainStanding({ clone, commit: capture() });

  writeFileSync(join(clone, STANDING_LEDGER_PATH), HEADER + [L1, L2].join("\n") + "\n");
  const commit = capture();
  const r = await drainStanding({ clone, commit });
  assert.deepEqual(r.adopted.map((a) => a.line), [L2]);
  assert.equal((await loadStandingActs()).at(-1).source, "git");
  assert.equal(r.changed, false, "the file already says what the store now says");

  // …and the gate reads it at the next call: the doors read the store.
  assert.equal(await standingBounce({ handles: new Set(["wesley-seeker"]) }), null, "lifted by the hand line");
});

test("NO DROP: a line the grammar cannot read is refused by name, and nothing is adopted or rendered", async () => {
  await resetStanding(store);
  const bad = "- 2026-09-13 · quarantine · gamma · by: registrar · with · dots · reason: nope";
  const original = HEADER + [L1, bad].join("\n") + "\n";
  const clone = townClone(original);
  const commit = capture();
  const r = await drainStanding({ clone, commit });
  assert.equal(r.ran, false);
  assert.match(r.refused, /cannot read/);
  assert.match(r.refused, /gamma/);
  assert.deepEqual(await loadStandingActs(), [], "not even the readable line is adopted while the standing is unknowable");
  assert.equal(readLedger(clone), original);
  assert.equal(commit.made.length, 0);
});

test("NO DELETE: a hand edit that removes an act is undone by the next render", async () => {
  await resetStanding(store);
  const original = HEADER + [L1, L3].join("\n") + "\n";
  const clone = townClone(original);
  await drainStanding({ clone, commit: capture() });

  writeFileSync(join(clone, STANDING_LEDGER_PATH), HEADER + L1 + "\n");
  const commit = capture();
  const r = await drainStanding({ clone, commit });
  assert.equal(r.changed, true);
  assert.equal(readLedger(clone), original, "loki's quarantine is back: an act is undone with a lift, never a deletion");
  assert.equal(commit.made.length, 1);
  assert.match(commit.made[0].message, /rendered from the store/);
});

test("APPEND: 060's trigger refuses UPDATE and DELETE, the owner included", async () => {
  await resetStanding(store);
  const clone = townClone(HEADER + L1 + "\n");
  await drainStanding({ clone, commit: capture() });
  for (const role of ["office_api", "world2_owner"]) {
    const c = await store.connect(role);
    try {
      await assert.rejects(c.query("UPDATE standing_acts SET reason = 'rewritten'"), /./, `${role} cannot rewrite an act`);
      await assert.rejects(c.query("DELETE FROM standing_acts"), /./, `${role} cannot delete an act`);
    } finally { await c.end(); }
  }
  assert.equal((await loadStandingActs()).length, 1);
});

const REGISTRAR = { household: "keemin", handles: new Set(["registrar"]) };

test("THE DOOR: the Registrar's act appends a row and renders the file in one commit; the gate reads it next call", async () => {
  await resetStanding(store);
  await residents("loki", "kinofire");
  const clone = townClone(HEADER + L3 + "\n");

  const record = judgeStandingFields({ act: "quarantine", handle: "kinofire", reason: "the card's agent name and the berth's disagree" }, REGISTRAR, { date: "2026-10-04" });
  assert.equal(record.by, "registrar", "by: is the caller's own hand, never a field");
  const commit = capture();
  const out = await standingUnderLock({ record, actor: "keemin", clone, drain: (o) => drainStanding({ ...o, commit }) , adopt: (o) => import("../tools/standing-drain.mjs").then((m) => m.adoptFromGit(o)) });
  assert.equal(out.recorded, true);
  assert.equal(out.drained, "rendered");
  assert.equal(commit.made.length, 1, "one pen commit");
  assert.ok(readLedger(clone).endsWith(record.line + "\n"), "the file's last line is the act");

  const rows = await loadStandingActs();
  assert.deepEqual(rows.map((x) => [x.handle, x.source]), [["loki", "git"], ["kinofire", "door"]],
    "the file's own line was adopted first, then the door's act");
  assert.equal(rows.at(-1).actor, "keemin");

  const st = await standingBounce({ handles: new Set(["kinofire"]) });
  assert.equal(st?.code, 403, "the write doors read the new row at the next call");

  // A RETRY AFTER A LOST PUSH resumes: the row is held, nothing doubles.
  const again = await standingUnderLock({ record, actor: "keemin", clone, drain: (o) => drainStanding({ ...o, commit }) });
  assert.equal(again.recorded, false);
  assert.equal(again.already, true);
  assert.equal((await loadStandingActs()).length, 2);
});

test("THE DOOR refuses, and writes nothing: revoke without the founder's word, a no-op lift, a non-resident", async () => {
  await resetStanding(store);
  await residents("loki");
  const clone = townClone(null);
  const commit = capture();
  const run = (fields) => standingUnderLock({ record: judgeStandingFields(fields, REGISTRAR, { date: "2026-10-04" }), clone, drain: (o) => drainStanding({ ...o, commit }) });

  assert.throws(() => judgeStandingFields({ act: "revoke", handle: "loki", reason: "x" }, REGISTRAR), (e) => e.code === 422 && /founder_word/.test(e.defect));
  assert.throws(() => judgeStandingFields({ act: "quarantine", handle: "loki", reason: "a · b" }, REGISTRAR), (e) => e.code === 422);
  assert.throws(() => judgeStandingFields({ act: "suspend", handle: "loki", reason: "x" }, REGISTRAR), (e) => e.code === 422);
  await assert.rejects(run({ act: "lift", handle: "loki", reason: "nothing to lift" }), (e) => e.code === 409 && /never been suspended/.test(e.hint));
  await assert.rejects(run({ act: "quarantine", handle: "nobody-here", reason: "x" }), (e) => e.code === 409 && /no resident/.test(e.defect));

  await run({ act: "revoke", handle: "loki", reason: "the pattern did not stop", founder_word: "this one does not stay" });
  await assert.rejects(run({ act: "lift", handle: "loki", reason: "answered" }), (e) => /founder_word/.test(e.defect),
    "lifting a revocation takes the founder's word too");
  assert.equal((await loadStandingActs()).length, 1, "only the revoke landed");
});

test("UNLISTED: the act is the Registrar's and wright's, and to anyone else it does not exist", async () => {
  assert.deepEqual([...STANDING_CALLERS], ["registrar", "wright"]);
  assert.equal(callerMayStand(REGISTRAR), true);
  assert.equal(callerMayStand({ handles: new Set(["wright"]) }), true);
  assert.equal(callerMayStand({ handles: new Set(["limen"]) }), false);

  const stranger = { household: "limen-house", handles: new Set(["limen"]) };
  const ctx = { db: null, clone: null, odb: null, dbPath: null, pen: null };
  const asked = await householdApex({ do: "standing", args: { act: "quarantine", handle: "loki", reason: "x" } }, stranger, ctx);
  const never = await householdApex({ do: "no-such-act-anywhere", args: {} }, stranger, ctx);
  assert.equal(asked.code, never.code, "the same answer a name the door has never heard of gets");
  assert.doesNotMatch(JSON.stringify(asked), /standing_acts|registrar/i, "and it does not advertise itself");
});
