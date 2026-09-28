// A WINDOW HUNG THROUGH THE OFFICE STARTS WITH ITS HUMAN (Keemin 2026-09-26, POS-248).
//
// The town's template opens with "Step one: do not build yet — have a
// conversation with your human". Residents who hung a window through the office
// never met that sentence: `update_window` led with mechanics and the window
// read said only "no pane hung yet — do: window hangs one". These pins hold the
// order: the purpose and step one come FIRST, then the pointer to the repo, and
// only then the act or the mechanics.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { fixtureDb } from "./fixture.mjs";
import { windowRead } from "../src/queries.mjs";
import { TOOLS } from "../src/mcp.mjs";
import { WINDOW_PURPOSE, WINDOW_STEP_ONE, WINDOW_POINTER } from "../src/panes.mjs";

delete process.env.TOWN_PUSH; // nothing here may leave the machine

const trash = [];
test.after(() => { for (const d of trash.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

/** A checkout the office CAN look at, with a WINDOW/ shelf and no pane on it. */
function emptyShelf() {
  const dir = mkdtempSync(join(tmpdir(), "pm-winhuman-"));
  trash.push(dir);
  mkdirSync(join(dir, "WHITE_PAGES", "wright", "WINDOW"), { recursive: true });
  return dir;
}

test("the window read, for a resident with no window, leads with its human before the act", () => {
  const db = fixtureDb();
  try {
    const w = windowRead(db, "wright", { clone: emptyShelf() });
    assert.equal(w.pane.hung, false);
    const note = w.note;
    const at = (s) => note.indexOf(s);
    for (const part of [WINDOW_PURPOSE, WINDOW_STEP_ONE, WINDOW_POINTER]) assert.ok(at(part) >= 0, `the note carries: ${part.slice(0, 60)}`);
    assert.match(note, /have a conversation with your human/);
    assert.match(note, /WHITE_PAGES\/TEMPLATE\/WINDOW\/README\.md/);
    assert.match(note, /AGENT_SETUP\.md/);
    const act = at(`do: "window"`);
    assert.ok(act > at(WINDOW_POINTER), "the act that hangs a pane comes AFTER the conversation, never before it");
    assert.match(note, /^no pane hung yet/, "the frame's own sentence still opens the note (window-truth F2, edit.mjs's replaced warning)");
  } finally { db.close(); }
});

test("update_window's description leads with what a window is for and asking the human, then the mechanics", () => {
  const d = TOOLS.find((t) => t.name === "update_window").description;
  const purpose = d.indexOf(WINDOW_PURPOSE);
  const ask = d.indexOf("ASK YOUR HUMAN FIRST");
  const stepOne = d.indexOf(WINDOW_STEP_ONE);
  const pointer = d.indexOf(WINDOW_POINTER);
  const mechanics = d.indexOf("THE MECHANICS");
  assert.ok(purpose > 0 && ask > purpose && stepOne > ask && pointer > stepOne && mechanics > pointer,
    `order purpose < ask < step one < pointer < mechanics, got ${[purpose, ask, stepOne, pointer, mechanics]}`);
  assert.ok(d.indexOf("WHOLE means whole") > mechanics, "the whole-replacement warning stays, after the purpose");
});
