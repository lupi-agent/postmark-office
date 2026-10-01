// pos-156-the-record-is-written-from-the-store.test.mjs — PART 0 of G1: the
// departure record's WRITER moves from `dynamic.db/movements` to `acts`.
//
// POS-196 built the renderer (`storedDepartureEvents`), the `--check`
// instrument and the equality falsifier, and held the swap on one measured
// STOP: the register carried no departure INSTANT, and `at` is the first field
// every world reader reads. POS-198 closed it — `walkViaOffice` reads the
// declaration clock once and hands the same string to both pens. This is the
// swap those two lanes were held for, and these are its falsifiers.
//
// WHAT IS PROVEN HERE, each written so it CAN fail:
//
//   the writer moved        the two write paths that rendered the live era from
//                           `dynamic.db/movements` — `crossing-save`'s
//                           `<N>.jsonl` half and `refreshEntities`' entities (the latter
//                           retired with the entities table, POS-269)
//                           derivation — call `storedDepartureEvents` and no
//                           longer call `readMovements`. Source pins, because
//                           the alternative is a behavioural test that passes
//                           against either pen (both render the same shape;
//                           that was the whole design of the renderer).
//   the refusal is not an   (RETIRED with the entities table, POS-269, along
//   outage, and its         with its control. They held that `refreshEntities`
//   control                 refused an unreadable register by name and left the
//                           table where it was; the save's own refusal is the
//                           `stored.absent` pin in § 1.)
//
// The byte-equality half of part 0 is not re-asserted here — it is POS-198's
// "POST-CHANGE EQUALITY: acts built by the LIVE writers read byte-equal on all
// nine fields", in test/departures-written-from-the-store.test.mjs, and a
// second copy of it would be a second yardstick for one claim.
//
//   node --test test/pos-156-the-record-is-written-from-the-store.test.mjs

import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import {
  fixtureWorldClone, fixtureWorldDb, mainShaOf, scratchDir, crossingStart,
} from "./dynamic-fixture.mjs";

const scratch = scratchDir("pos156-writer");
const repo = fixtureWorldClone({ label: "pos156-writer" });
const sweep = (d) => { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } };
after(() => { sweep(scratch); sweep(repo); });

const SHA = mainShaOf(repo);
const worldDbPath = join(scratch, "world.db");

process.env.WORLD_CLONE = repo;
process.env.WORLD_STORE_DB = worldDbPath;

const T0 = crossingStart(100);
const DEPARTURES = [
  { at: new Date(T0).toISOString(), actor: "wright", from: { x: 0, y: 0 }, toward: { x: 0, y: 0 }, crossing: 100, line_no: 1 },
  { at: new Date(T0).toISOString(), actor: "iris", from: { x: 0, y: 0 }, toward: { x: 100, y: 0 }, crossing: 100, to: "the-town/quay", line_no: 2 },
];

beforeEach(async () => {
  fixtureWorldDb(worldDbPath, { sha: SHA, departures: DEPARTURES });
  const { resetClassCache } = await import("../src/dynamic-store.mjs");
  resetClassCache();
});

// ── 1. THE WRITER MOVED ──────────────────────────────────────────────────────
//
// ⚑ THE PINS READ CODE, NOT PROSE. Both files NAME `readMovements` in the
// comment that records what this swap replaced — that sentence is the reason
// the next reader understands the seam, and a pin that fired on it would either
// delete the explanation or, worse, be "fixed" by deleting it. So the comments
// come off first and the assertion is about what runs.
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
//
// Source pins, deliberately. Both pens render the same `events` row shape —
// that is the renderer's whole design, and it is why the seam is invisible to
// `mergedDepartureEvents` — so a behavioural test on the OUTPUT would pass
// against either one and prove nothing about which is wired. What the swap
// changes is which table is read, and that is a fact about the source.

test("`crossing-save`'s write path renders the live era from the REGISTER, not from `movements`", () => {
  const text = readFileSync(new URL("../tools/crossing-save.mjs", import.meta.url), "utf8");

  const code = codeOnly(text);

  // The whole file, imports included: `readMovements` must not be reachable
  // from this tool at all, or a later edit could re-wire it without moving a
  // single line of the write path.
  assert.equal(/\breadMovements\b/.test(code), false,
    "`tools/crossing-save.mjs` still reaches `readMovements` — the reverse-mirror copy G1 removes");

  const body = code.slice(code.indexOf("const read = readDepartureEvents("));
  assert.ok(body.length > 200, "the write path was not found — this pin is reading the wrong region");
  assert.match(body.slice(0, 3000), /storedDepartureEvents\(\{\s*atMs:\s*saveMs\s*\}\)/,
    "the live era is no longer rendered from the register at the save instant");
  assert.match(body.slice(0, 3000), /stored\.absent/,
    "an unreachable register must be a refusal here — the thing this tool commits is a public file");
});

// (`refreshEntities` had the same pin here. It went with the entities table,
// POS-269; the crossing-save pin above is the writer that remains.)

test("the stamp on a rendered line is `acts`, and it is the one field the world does not read", async () => {
  const { DEPARTURE_GAPS, RECORD_READ_FIELDS, departureEventOf } = await import("../src/world-movement.mjs");
  const line = departureEventOf({
    act_id: 7, iso: "2026-09-22T00:14:40.194Z", handle: "neth",
    from: { x: 1, y: 2 }, toward: { x: 3, y: 4 }, at: 204.02,
    targetExtent: null, targetMarkId: null, pace: 60,
  });
  assert.equal(JSON.parse(line.payload).source, "acts");
  assert.equal(RECORD_READ_FIELDS.includes("payload.source"), false,
    "`source` is in the world's read set — then it is not a free diff and the swap is not byte-equal");
  assert.match(DEPARTURE_GAPS.source, /allowed stamp diff/);
});

// ── 2. THE REFUSAL IS NOT AN OUTAGE ──────────────────────────────────────────

// (A register that cannot be read refused `refreshEntities` by name and left
// the entities table where it was. The table is gone, POS-269; the save's own
// refusal on an unreachable register is pinned above — `stored.absent`.)

// (Its control — no register derives the frozen era — went with it.)
