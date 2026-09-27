// doorstep-psa.test.mjs — the registrar's week rides the doorstep, as text.
//
// RULING A (Keemin, 2026-08-22), verbatim: "change doorstep s.t. residents get
// all PSAs made in the last week (up to 5) as actual text? and be sure to put
// any hard coded stuff as predicate nodes under doorstep as opposed to
// anywhere else."
//
// Both halves are asserted, and both against real inputs:
//
//   the TEXT half  — parsed from the town's OWN public-service-announcements
//                    wall, read off the checkout, not a fixture string. The
//                    registrar writes headings by hand ("## 2026-08-17 (night)
//                    — …"); a parse tuned to an invented sample would keep
//                    passing while the real wall returned nothing, and a fold
//                    that silently returns nothing looks exactly like a quiet
//                    week. So the wall itself is the input.
//   the DIALS half — read off the hydrated world store, per the same
//                    departure→depart lesson say-dials.test.mjs carries.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { parsePsaEntries, psaFold, PSA_SLUG } from "../src/queries.mjs";
import { dialNumber } from "../src/world-classes.mjs";
import { storeDbPath } from "../src/world-serve.mjs";
import { CLASS_ROSTER_GATE_SQL } from "../src/world-store.mjs";
import { townClone } from "./fixture-paths.mjs";

// The town checkout the office is pointed at. Every candidate the repo's own
// tooling uses; the test says which it found rather than inventing a wall.
const TOWN = [townClone()]
  .filter(Boolean).find((p) => existsSync(join(p, "TOWN_BULLETIN", `${PSA_SLUG}.md`)));

const wallText = TOWN
  ? readFileSync(join(TOWN, "TOWN_BULLETIN", `${PSA_SLUG}.md`), "utf8").replace(/^---[\s\S]*?\r?\n---\r?\n/, "")
  : null;

// A db stub that serves ONE row: the real wall. The fold's only db touch is
// this single SELECT, so standing a whole index up to read one file would test
// the hydrator, not the fold.
const dbOf = (body) => ({ prepare: () => ({ get: () => (body === null ? undefined : { json: JSON.stringify({ body }) }) }) });

describe("the wall parses", { skip: wallText ? false : "no town checkout carrying the PSA wall — skipping rather than parsing an invented one" }, () => {
  test("every entry on the real wall is found, with its date, its title and its own text", () => {
    const entries = parsePsaEntries(wallText);
    assert.ok(entries.length > 20,
      `only ${entries.length} entries parsed off a wall that carries years of the registrar's book — the heading grammar has drifted`);
    for (const e of entries) {
      assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/, `bad date on "${e.title}"`);
      assert.ok(e.title.trim().length > 0, `an entry parsed with no title (${e.date})`);
      assert.ok(e.text.trim().length > 0, `"${e.title}" parsed with no text — the ruling asks for actual text`);
      assert.equal(/^##\s/.test(e.text), false, `"${e.title}" swallowed the next entry's heading`);
    }
  });

  test("the registrar's time-of-day qualifier survives, and does not eat the title", () => {
    const entries = parsePsaEntries(wallText);
    const qualified = entries.filter((e) => e.qualifier);
    assert.ok(qualified.length > 0,
      "no qualified heading parsed — the wall carries several ('## 2026-08-17 (night) — …') and losing them silently merges a day's entries");
    for (const e of qualified) {
      assert.equal(/[()]/.test(e.title), false, `"${e.title}" kept its parenthetical — the qualifier is its own field`);
    }
  });

  test("entries come back newest first", () => {
    const dates = parsePsaEntries(wallText).map((e) => e.date);
    assert.deepEqual(dates, [...dates].sort((a, b) => b.localeCompare(a)),
      "the week's news must lead with the newest — a doorstep that opens on old news is wallpaper");
  });
});

describe("the fold", { skip: wallText ? false : "no town checkout carrying the PSA wall" }, () => {
  // A fixed day, so the window is a fact and not today's weather.
  const DAY = Date.parse("2026-08-22T12:00:00Z");

  test("only entries inside the window ride, and only up to the cap", () => {
    const f = psaFold(dbOf(wallText), { now: DAY });
    assert.ok(f.entries.length <= f.max, `${f.entries.length} entries returned against a cap of ${f.max}`);
    const oldest = Date.parse("2026-08-22T00:00:00Z") - f.window_days * 86_400_000;
    for (const e of f.entries) {
      assert.ok(Date.parse(`${e.date}T00:00:00Z`) >= oldest,
        `${e.date} is older than the ${f.window_days}-day window`);
      assert.ok(e.text.length > 0, `${e.date} rode without its text — "as actual text" is the ruling`);
    }
  });

  test("what the cap holds back is DISCLOSED, never silently dropped", () => {
    const f = psaFold(dbOf(wallText), { now: DAY });
    if (f.more) {
      assert.match(f.more_note, /read_bulletin/, "the overflow note must say where the rest is");
    }
    // the wall as of this writing carries more than a cap's worth in a week,
    // so the disclosure is exercised rather than merely defined
    assert.ok(typeof f.more === "number" || f.entries.length < f.max,
      "either the cap bit and said so, or the week genuinely held fewer than the cap");
  });

  test("a quiet week reads as a quiet week, not as a broken fold", () => {
    const f = psaFold(dbOf(wallText), { now: Date.parse("2030-01-01T00:00:00Z") });
    assert.deepEqual(f.entries, []);
    assert.match(f.note, /quiet week/, "an empty window must name itself");
  });

  test("a checkout with no wall at all is an ABSENCE, and says so", () => {
    const f = psaFold(dbOf(null), { now: DAY });
    assert.deepEqual(f.entries, []);
    assert.match(f.note, /carries no public-service-announcements/,
      "a missing wall must not read as a quiet week — they are different facts");
  });
});

const DB = storeDbPath();
const storeHasDoorstep = existsSync(DB) && (() => {
  try {
    const db = new DatabaseSync(DB, { readOnly: true });
    const row = db.prepare(
      `SELECT 1 AS ok FROM nodes WHERE ${CLASS_ROSTER_GATE_SQL} AND json_extract(props, '$.class') = 'doorstep' LIMIT 1`).get();
    db.close();
    return Boolean(row?.ok);
  } catch { return false; }
})();

describe("the dials come off the record", { skip: storeHasDoorstep ? false : `no hydrated world store carrying the-town/doorstep at ${DB} — run: npm run hydrate:world` }, () => {
  test("the window and the cap are the doorstep node's own predicates, not numbers in this repo", () => {
    for (const [slot, want] of Object.entries({ psa_window_days: 7, psa_max: 5 })) {
      const d = dialNumber("doorstep", slot, -1, { min: 0 });
      assert.equal(d.source, "record", `${slot} fell back — "put any hard coded stuff as predicate nodes under doorstep"`);
      assert.equal(d.value, want, `${slot} read ${d.value}, the node declares ${want}`);
    }
  });

  test("the fold reports WHICH numbers it read and which it fell back on", () => {
    const f = psaFold(dbOf(wallText ?? ""), { now: Date.parse("2026-08-22T12:00:00Z") });
    assert.deepEqual(f.dials, { psa_window_days: "record", psa_max: "record" },
      "a fold standing on constants must say so — a silent fallback is indistinguishable from a good read");
  });

  test("NO DIAL-SHAPED NUMBER IS WRITTEN INTO THE FOLD'S OWN CODE", () => {
    const src = readFileSync(new URL("../src/queries.mjs", import.meta.url), "utf8");
    const fold = src.slice(src.indexOf("export function psaFold"), src.indexOf("export function bulletinEntry"));
    // 0 and 1 are structure — an array index, a length test, a plural. Any
    // OTHER literal in this body is a magic number, and the two that matter
    // (the window and the cap) may appear only as the named fallback argument
    // on a dialNumber line, where they are visibly not the law.
    const offenders = [];
    for (const line of fold.split(/\r?\n/)) {
      if (/^\s*(\/\/|\*|\/\*)/.test(line) || /dialNumber\(/.test(line)) continue;
      for (const m of line.matchAll(/(?<![\w.$])\d[\d_]*(?:\.\d+)?/g)) {
        if (m[0] === "0" || m[0] === "1") continue;
        offenders.push(`${m[0]} in: ${line.trim().slice(0, 72)}`);
      }
    }
    assert.deepEqual(offenders, [],
      "psaFold grew a number of its own — the window and the cap live on the doorstep node and nowhere else");
  });
});
