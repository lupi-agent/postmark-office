// hydrate-bounty.test.mjs — a bounty's ask, reward and status reach the rows
// (office#295, POS-270 lane W).
//
// The bounty board read every notice as OPEN with a null ask and reward: the
// hydrator's props block is an EXPLICIT field list, and `ask`, `reward` and
// `status` were never on it, so `bountyBoard`'s json_extract(props, '$.ask' |
// '$.reward' | '$.status') read NULL and the board's own default called it
// open. The third instance of one class in that block (`dials`, then `loot`).
// Both readers stand on these rows — the file before lane W 3b, the store's
// snapshot after — so the rows are where it is fixed and where it is pinned.
//
// Two legs: a fixture world, whose marks cannot drift, and the real case on
// world main (wright/furnish-ferrys-waiting-room: closed, reward 1), read back
// through the board itself.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { WORLD_CLONE } from "../src/world-store.mjs";
import { publishWorld } from "./helpers/world-rows.mjs";

const OFFICE = resolve(fileURLToPath(new URL("..", import.meta.url)));
const HAVE_WORLD = existsSync(join(WORLD_CLONE, "tools", "marks-fold.mjs"));

const gitq = (dir, args) => execFileSync("git", ["-C", dir, ...args], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
});

/** The hydration's rows for a world checkout, in its own tmp root. */
function hydrateRows(worldDir, dir) {
  const rows = join(dir, "rows.json");
  const r = spawnSync(process.execPath,
    [join(OFFICE, "src", "world-hydrate.mjs"), "--world", worldDir, "--no-db", "--rows-out", rows, "--office", OFFICE, "--no-lints", "--no-gexf"],
    { encoding: "utf8", env: { ...process.env, TMP: dir, TEMP: dir, TMPDIR: dir } });
  if (r.status !== 0) assert.fail(`hydration exited ${r.status}\n${r.stdout}\n${r.stderr}`);
  return JSON.parse(readFileSync(rows, "utf8"));
}
const propsOf = (tables, id) => { const n = tables.nodes.find((x) => x.id === id); return n ? JSON.parse(n.props) : null; };

test("A BOUNTY'S ask, reward AND status reach the rows, as the mark file says them", { timeout: 180_000 }, (t) => {
  if (!HAVE_WORLD) return t.skip(`no world clone at ${WORLD_CLONE}`);
  const dir = mkdtempSync(join(tmpdir(), "pm-bounty-"));
  try {
    const world = join(dir, "world");
    cpSync(join(WORLD_CLONE, "tools"), join(world, "tools"), { recursive: true });
    const mark = (rel, front, body) => {
      mkdirSync(join(world, "WORLD", "marks", rel), { recursive: true });
      writeFileSync(join(world, "WORLD", "marks", rel, "mark.md"), `---\n${front}\n---\n\n${body}\n`);
    };
    mark("let-there-be-light",
      "kind: sited\nby: the-town\ntier: constitution\ndate: 2026-07-22\nat: { x: 0, y: 0 }\nextent: { w: 320000, h: 320000 }\ncoords: relative",
      "Let there be light.");
    gitq(world, ["init", "-q", "."]);
    gitq(world, ["add", "-A"]);
    gitq(world, ["commit", "-qm", "the frame"]);
    // Written as FILES, through the world's own parser: `reward: 1` arrives a number.
    mark("wright/a-closed-notice",
      "kind: sited\nby: wright\ndate: 2026-09-26\nat: { x: 1, y: 1 }\nextent: { w: 1, h: 1 }\nclass: bounty\nask: Closed, with thanks.\nreward: 1\nstatus: done",
      "Closed.");
    // An open notice says no status at all: the board's default is what makes it open.
    mark("wright/an-open-notice",
      "kind: sited\nby: wright\ndate: 2026-09-27\nat: { x: 3, y: 1 }\nextent: { w: 1, h: 1 }\nclass: bounty\nask: Paint the quay.\nreward: 3",
      "Open.");
    gitq(world, ["add", "-A"]);
    gitq(world, ["commit", "-qm", "two notices"]);

    const tables = hydrateRows(world, dir);
    const closed = propsOf(tables, "wright/a-closed-notice");
    assert.ok(closed, "the closed notice did not hydrate at all — this test would prove nothing");
    assert.equal(closed.status, "done", "a closed notice's status did not reach the rows — the board reads it OPEN");
    assert.equal(closed.ask, "Closed, with thanks.");
    assert.equal(closed.reward, 1);
    const open = propsOf(tables, "wright/an-open-notice");
    assert.equal(open.status, null, "a notice that says no status must not be given one here: the board's default is the reader's");
    assert.equal(open.ask, "Paint the quay.");
    assert.equal(open.reward, 3);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("THE REAL CASE: wright/furnish-ferrys-waiting-room reads back DONE on the bounty board, with its ask and its reward", { timeout: 180_000 }, async (t) => {
  if (!HAVE_WORLD) return t.skip(`no world clone at ${WORLD_CLONE}`);
  // The live record, pinned by name (Keemin, 2026-10-01: "on world main"). A
  // clone that does not carry it skips by name rather than pass on nothing.
  const has = execFileSync("git", ["-C", WORLD_CLONE, "ls-files", "WORLD/marks"], { encoding: "utf8" })
    .split("\n").some((p) => p.endsWith("/furnish-ferrys-waiting-room/mark.md"));
  if (!has) return t.skip(`the world clone at ${WORLD_CLONE} does not carry furnish-ferrys-waiting-room`);
  const dir = mkdtempSync(join(tmpdir(), "pm-bounty-real-"));
  try {
    publishWorld(hydrateRows(WORLD_CLONE, dir), "the world checkout");
    const { bountyBoard } = await import("../src/world-classes.mjs");
    const board = bountyBoard();
    assert.equal(board.source, "store", `the board did not read the world: ${board.disclosed ?? ""}`);
    const notice = board.notices.find((b) => b.id === "wright/furnish-ferrys-waiting-room");
    assert.ok(notice, "the notice is not on the board at all");
    assert.equal(notice.status, "done", "the closed notice reads OPEN — the bug office#295 names");
    assert.equal(notice.reward, 1);
    assert.match(String(notice.ask), /^Closed, with thanks: the room is furnished\./);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
