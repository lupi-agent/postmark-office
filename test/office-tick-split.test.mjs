// office-tick-split.test.mjs — the office tick, split in two (POS-268, 2026-09-27).
//
// The rehydrate unit used to run everything the office does on a clock: pull
// the clones, catch the mint up, write the settlements row, publish the panes,
// AND rebuild office.db + world.db. Retiring the sqlite reads deletes the last
// of those and must not delete the rest, so the keeping work moved to its own
// unit and the rehydrate unit keeps only the two hydrates.
//
// ⚑ TEXT PINS, like welcome-pass.test.mjs and settlements-backfill.test.mjs:
// nothing in a unit test can run a systemd unit, and what these hold is which
// file carries which line.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (f) => readFileSync(new URL(`../deploy/${f}`, import.meta.url), "utf8");
const calendarOf = (timer) => read(timer).split(/\r?\n/).filter((l) => l.startsWith("OnCalendar=")).map((l) => l.slice(11));
const execOf = (svc) => read(svc).split(/\r?\n/).find((l) => l.startsWith("ExecStart="));

const KEEPING = [
  ['git -C "$TOWN_CLONE" pull --ff-only', "the town pull"],
  ['git -C "$WORLD_CLONE" fetch --prune', "the world fetch (it carries the keeper's tag)"],
  ["stamp-mint.mjs --append", "the mint catch-up"],
  ["deploy/welcome-pass.mjs", "the welcome pass"],
  ["settlements-backfill.mjs --apply", "the settlements row"],
  ["deploy/publish-windows.mjs", "the panes"],
];
const HYDRATES = [
  ["node src/hydrate.mjs", "office.db"],
  ["node src/world-hydrate.mjs", "world.db"],
];

test("the keeping tick carries every keeping step and neither hydrate", () => {
  const sh = read("office-keep.sh");
  for (const [line, what] of KEEPING) assert.ok(sh.includes(line), `office-keep.sh lost ${what}`);
  for (const [line, what] of HYDRATES) assert.ok(!sh.includes(line), `office-keep.sh rebuilds ${what} — that is the rehydrate unit's, and only its`);
});

test("the rehydrate script carries both hydrates and no keeping step", () => {
  const sh = read("office-rehydrate.sh");
  for (const [line, what] of HYDRATES) assert.ok(sh.includes(line), `office-rehydrate.sh lost the ${what} rebuild`);
  for (const [line, what] of KEEPING) assert.ok(!sh.includes(line), `office-rehydrate.sh still runs ${what}; deleting the rehydrate unit would take it along`);
  // it reads the clone under the town lock, for the snapshot only
  assert.match(sh, /flock -w 300 9\n\s*git clone --local --quiet "\$TOWN_CLONE" "\$SNAP\/town"\n\) 9>>"\$LOCK"/,
    "the snapshot is taken under the town lock, and nothing else is");
});

test("each unit runs its own half", () => {
  assert.match(execOf("postmark-office-keep.service"), /deploy\/office-keep\.sh$/);
  assert.match(execOf("postmark-office-rehydrate.service"), /deploy\/office-rehydrate\.sh$/);
  for (const svc of ["postmark-office-keep.service", "postmark-office-rehydrate.service"]) {
    assert.match(read(svc), /^User=meepo$/m, `${svc}: the User= line is load-bearing (the 2026-07-09 outage)`);
    assert.match(read(svc), /^EnvironmentFile=\/etc\/postmark-office\.env$/m, `${svc}: TOWN_CLONE and WORLD_CLONE come from here`);
  }
});

test("the keeping tick keeps the old clock; the rehydrate follows it", () => {
  assert.deepEqual(calendarOf("postmark-office-keep.timer"), ["*:07,22,37,52"],
    "the pulls, the mint, the settlements row and the panes keep the freshness they had");
  assert.deepEqual(calendarOf("postmark-office-rehydrate.timer"), ["*:09,24,39,54"],
    "two minutes after the keeping tick, which freshens the clones it reads");
});

test("a box on the pre-split unit still runs both halves, keeping first", () => {
  // The installed rehydrate unit names office-tick.sh until someone copies the
  // new unit files in; a code deploy alone must not stop the keeping work.
  const sh = read("office-tick.sh");
  const keep = sh.indexOf('sh "$HERE/office-keep.sh"');
  const reh = sh.indexOf('sh "$HERE/office-rehydrate.sh"');
  assert.ok(keep !== -1 && reh !== -1, "the transitional tick must run both halves");
  assert.ok(keep < reh, "the keeping half pulls the clones the rehydrate reads, so it goes first");
  assert.match(sh, /^set -eu$/m, "a failed pull stops the rehydrate, exactly as it did before the split");
});

test("the roll-call knows the new unit, parked until its files are installed", async () => {
  const m = JSON.parse(read("box-rollcall-manifest.json"));
  const row = m.units.find((u) => u.unit === "postmark-office-keep.timer");
  assert.ok(row, "every postmark-* timer must have a manifest row");
  assert.equal(row.stage, "parked");
  assert.match(row.adopt_command, /enable --now postmark-office-keep\.timer/);
  assert.ok(m.trees.rows.some((r) => r.unit === "postmark-office-keep.service"), "the keep unit names a tree, so the trees block must name it back");
});
