// intake-addresses.test.mjs — the check deploy/intake-addresses.json never had
// (POS-346, part 3).
//
// That file decides which pot a stranger's USDC pays, read off the address it
// landed on. It's written by an office commit and read by usdc-watch and the
// /fund door (src/intake-map.mjs), and until now nothing checked it before it
// shipped: a row the reader refuses only shows up as an `invalid` line in a
// report. These checks are the file's own stated rules:
//
//   every row parses       readIntakeMap's refusals are zero on the committed file
//   lowercase              "address (lowercase) -> pot id" (the file's `_`)
//   never the shared one   "Do NOT map the shared intake address to a pot"
//                          (the file's `_never`)
//   a pot the town posts   "a pot id must be a pot the town posts
//                          (WHITE_PAGES/pot-<id>.json)" (`_how_to_use_it`), held
//                          against the pinned town-clone
//
//   node --test test/intake-addresses.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { INTAKE_MAP_FILE, readIntakeMap } from "../src/intake-map.mjs";
import { INTAKE } from "../src/usdc-witness.mjs";
import { NO_TOWN, townClone } from "./fixture-paths.mjs";

const raw = JSON.parse(readFileSync(INTAKE_MAP_FILE, "utf8"));
const rows = Object.entries(raw.addresses ?? {});

test("every row of deploy/intake-addresses.json is one the reader takes", () => {
  const { map, invalid } = readIntakeMap();
  assert.deepEqual(invalid, [], "readIntakeMap refused a row: it would ship as an `invalid` report line and the address would map to nothing");
  assert.equal(map.size, rows.length);
});

test("addresses are written lowercase, and the shared intake is never mapped to a pot", () => {
  for (const [addr] of rows) {
    assert.equal(addr, addr.toLowerCase(), `${addr}: the file keeps addresses lowercase`);
    assert.notEqual(addr.toLowerCase(), INTAKE, "the standing shared address must stay unmapped (the file's _never)");
  }
});

test("every mapped pot is a pot the town posts", { skip: townClone() ? false : NO_TOWN }, () => {
  for (const [addr, pot] of rows)
    assert.ok(existsSync(join(townClone(), "WHITE_PAGES", `pot-${pot}.json`)), `${addr} maps to "${pot}", and the town posts no WHITE_PAGES/pot-${pot}.json`);
});
