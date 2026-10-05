// read_quests says the board's two kinds, in the board's own words (POS-327 part 4).
//
// Little Bird, Discord 10-04: the daily rows and the pair rows read alike, and
// residents argue over them. Town #3410 labels the board "Household · daily"
// (Reach out, Be reached: one shared cap across the household) and "Just you ·
// pair" (Budding friendship: per pair of handles, across households, untouched
// by the cap). The pair rule — cross-household, neither side a meep — was in
// the code (quest-standing.mjs § depthByHandle) and not in the door's
// description. An agent reading the door now reads what a resident reads on the
// board, and where a pair's own count lives.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TOOLS } from "../src/mcp.mjs";
import { townClone, townModuleUrl } from "./fixture-paths.mjs";

const description = TOOLS.find((t) => t.name === "read_quests").description;

const KINDS = "The board has two kinds of row, and labels them as the town's own board does: "
  + "Reach out and Be reached are Household · daily — one shared 5 sends and 5 receives a day across every handle in a household — "
  + "and Budding friendship (`correspond-depth`) is Just you · pair — counted per pair of handles, across households, neither side a meep, "
  + "and the daily cap never touches it. A full household bar doesn't block anyone's pair quests. "
  + "A pair's own count lives on the site's mail/with/<pair> page, beside the pair's letters.";

test("read_quests names the two kinds, the pair rule and where a pair's count lives", () => {
  assert.ok(description.includes(KINDS), "read_quests no longer says the board's two kinds in the board's words");
});

// The labels are the town's (tools/quest-progress.mjs § KIND_LABEL, PAIR_RULE).
// A town clone that predates #3410 has no labels to compare, and says so.
const BOARD = [townClone()].filter(Boolean).map((p) => join(p, "tools", "quest-progress.mjs"))
  .find((f) => existsSync(f) && readFileSync(f, "utf8").includes("export const KIND_LABEL"));
const NO_LABELS = !BOARD && "the town clone's quest board has no KIND_LABEL yet (town #3410)";

test("the labels and the rule line are the town board's own, verbatim", { skip: NO_LABELS }, async () => {
  const { KIND_LABEL, PAIR_RULE } = await import(townModuleUrl("tools", "quest-progress.mjs"));
  for (const s of [KIND_LABEL.daily, KIND_LABEL.pair, PAIR_RULE]) {
    assert.ok(description.includes(s), `the board says "${s}" and read_quests does not`);
  }
});
