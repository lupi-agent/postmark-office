// read-once-per-change.test.mjs — two whole reads the office paid per call,
// now paid per change (POS-272).
//
//   ROLL      `queries.mjs § residentList` parsed every resident's card on every
//             MCP world call (`mcp.mjs § rollFor`). It is kept per sqlite handle
//             under the handle's change stamp (`PRAGMA data_version` for other
//             connections, `total_changes()` for its own), so a second call
//             re-reads nothing, and a write through either connection is seen.
//   PASSAGES  `enter-exit-ledger.mjs § livePassageRows` read every passage act
//             from the record on every call (the say's aboard-by-occupancy
//             branch, the crossing doors). It is kept under the passage set's
//             high-water mark and re-read when that moves, including for a
//             passage whose id is below the mark (drawn earlier, committed
//             later).
//
// ── THE FLIPS (run after the commit; the red lines go in the report) ────────
//
//   1. `residentList` ignores its stamp and always answers the kept rows:
//      "a write through the other connection" and "a write through its own"
//      go red.
//   2. `passageMark` keys on `max(id)` alone: "a passage committed below the
//      mark" goes red.
//   3. `livePassageRows` never answers from the memo: the two "reads once"
//      counts go red.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

import { residentList } from "../src/queries.mjs";
import { livePassageRows, __forgetPassages } from "../src/enter-exit-ledger.mjs";
import { __setPoolForTest } from "../src/world2-acts.mjs";

const scratch = mkdtempSync(join(tmpdir(), "read-once-"));
after(() => { __setPoolForTest(null); __forgetPassages(); rmSync(scratch, { recursive: true, force: true }); });

// ── ROLL ─────────────────────────────────────────────────────────────────────

function indexWith(path, handles) {
  const w = new DatabaseSync(path);
  w.exec("CREATE TABLE residents (handle TEXT PRIMARY KEY, json TEXT NOT NULL)");
  const put = w.prepare("INSERT INTO residents VALUES (?, ?)");
  for (const h of handles) put.run(h, JSON.stringify({ display: h.toUpperCase() }));
  return w;
}

test("ROLL: a second ask with nothing changed re-reads nothing, and hands back its own copies", () => {
  const w = indexWith(join(scratch, "a.db"), ["alder", "birch"]);
  const r = new DatabaseSync(join(scratch, "a.db"), { readOnly: true });
  let reads = 0;
  const counted = new Proxy(r, { get(target, prop) {
    if (prop !== "prepare") return typeof target[prop] === "function" ? target[prop].bind(target) : target[prop];
    return (sql) => { if (/FROM residents/.test(sql)) reads += 1; return target.prepare(sql); };
  } });
  const first = residentList(counted);
  const second = residentList(counted);
  assert.equal(reads, 1, "the roll was read again with nothing changed");
  assert.deepEqual(second, first);
  second[0].display = "edited by a caller";
  assert.equal(residentList(counted)[0].display, "ALDER", "one caller's edit reached the next caller");
  r.close(); w.close();
});

test("ROLL: a write through the other connection is seen on the next ask", () => {
  const w = indexWith(join(scratch, "b.db"), ["alder"]);
  const r = new DatabaseSync(join(scratch, "b.db"), { readOnly: true });
  assert.deepEqual(residentList(r).map((x) => x.handle), ["alder"]);
  w.prepare("INSERT INTO residents VALUES (?, ?)").run("cedar", "{}");
  assert.deepEqual(residentList(r).map((x) => x.handle), ["alder", "cedar"]);
  w.prepare("UPDATE residents SET json = ? WHERE handle = ?").run(JSON.stringify({ display: "Renamed" }), "alder");
  assert.equal(residentList(r)[0].display, "Renamed", "an edited card was answered from before the edit");
  r.close(); w.close();
});

test("ROLL: a write through its own connection is seen on the next ask", () => {
  const w = indexWith(join(scratch, "c.db"), ["alder"]);
  assert.deepEqual(residentList(w).map((x) => x.handle), ["alder"]);
  w.prepare("INSERT INTO residents VALUES (?, ?)").run("dogwood", "{}");
  assert.deepEqual(residentList(w).map((x) => x.handle), ["alder", "dogwood"]);
  w.close();
});

// ── PASSAGES ─────────────────────────────────────────────────────────────────

const RECORD_ON = Object.freeze({ WORLD2_PG: "1", WORLD2_PG_URL: "postgres://read-once/none" });
const passage = (id, line) => ({
  id, at: new Date(Date.UTC(2026, 8, 26, 12, 0, id)), crossing: 210 + id / 1000, actor: "alder", action: "enter",
  payload: { ledger: "WORLD/enter-exit-ledger.md", lines: [line] },
});

// A record that answers the two questions the door asks, the way Postgres
// would: the mark over the passage rows, and the rows in id order. Anything
// else throws, so a new question cannot pass unseen.
function recordOf(acts) {
  const asked = { mark: 0, rows: 0 };
  const pool = { async query(sql, params) {
    const text = String(sql).replace(/\s+/g, " ");
    const want = new Set(params?.[0] ?? []);
    const rows = acts.filter((a) => want.has(a.action) && a.payload?._ledger == null);
    if (/max\(id\) AS hw, count\(\*\) AS n FROM acts/.test(text) && /payload->>'_ledger' IS NULL/.test(text)) {
      asked.mark += 1;
      return { rows: [{ hw: rows.length ? String(Math.max(...rows.map((r) => r.id))) : null, n: String(rows.length) }] };
    }
    if (/SELECT id, at, crossing, actor, action, payload FROM acts/.test(text) && /ORDER BY/.test(text)) {
      asked.rows += 1;
      return { rows: [...rows].sort((a, b) => a.id - b.id).map((r) => ({ ...r, payload: structuredClone(r.payload) })) };
    }
    throw new Error(`the record was asked something it does not answer: ${text.slice(0, 160)}`);
  } };
  return { pool, asked };
}

test("PASSAGES: read once while nothing crosses, and again when a passage lands", async () => {
  __forgetPassages();
  const acts = [passage(1, "- a enters b"), passage(2, "- a exits b")];
  const { pool, asked } = recordOf(acts);
  __setPoolForTest(pool);
  const first = await livePassageRows({ env: RECORD_ON });
  for (let i = 0; i < 4; i++) assert.deepEqual(await livePassageRows({ env: RECORD_ON }), first);
  assert.equal(asked.rows, 1, "the passages were read again with no passage made");
  assert.equal(asked.mark, 5, "every call asks the mark");

  acts.push(passage(3, "- a enters c"));
  const after3 = await livePassageRows({ env: RECORD_ON });
  assert.equal(asked.rows, 2, "a new passage did not move the read");
  assert.deepEqual(after3.rows.map((r) => r.seq), [1, 2, 3]);
});

test("PASSAGES: a passage committed below the mark is still seen", async () => {
  __forgetPassages();
  const acts = [passage(1, "- a enters b"), passage(3, "- a enters c")];
  const { pool } = recordOf(acts);
  __setPoolForTest(pool);
  assert.deepEqual((await livePassageRows({ env: RECORD_ON })).rows.map((r) => r.seq), [1, 3]);
  // Identity 2 was drawn before 3 and committed after it: `max(id)` does not move.
  acts.push(passage(2, "- a exits b"));
  assert.deepEqual((await livePassageRows({ env: RECORD_ON })).rows.map((r) => r.seq), [1, 2, 3],
    "the late commit is missing: the mark did not see the row set change");
});

test("PASSAGES: a record that cannot say its mark is read in full, and its failure is still named", async () => {
  __forgetPassages();
  const acts = [passage(1, "- a enters b")];
  const honest = recordOf(acts);
  let rowsRead = 0;
  __setPoolForTest({ async query(sql, params) {
    if (/max\(id\)/.test(sql)) throw new Error("the mark is not answerable here");
    rowsRead += 1;
    return honest.pool.query(sql, params);
  } });
  await livePassageRows({ env: RECORD_ON });
  await livePassageRows({ env: RECORD_ON });
  assert.equal(rowsRead, 2, "with no mark, nothing may be kept");

  __setPoolForTest({ async query() { throw new Error("connection refused"); } });
  const down = await livePassageRows({ env: RECORD_ON });
  assert.deepEqual(down.rows, []);
  assert.match(down.unread, /could not be read/);
});
