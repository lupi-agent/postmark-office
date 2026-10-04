// THE FIXTURE ENGINE IS A TRANSCRIPTION, AND A TRANSCRIPTION NEEDS A READER.
//
//   node --test test/drain-pen-fixture.test.mjs
//
// `test/helpers/drain-pen.mjs` no longer points STAMP_ENGINE_DIR at somebody's
// town checkout; it writes a narrow one per run, carrying the two functions
// `town-drain` imports through that variable. Six suites now sign through that
// fixture. Nothing read it back against the town's own grammar, so it could
// drift from the law it claims to follow and every one of those six would stay
// green while doing it.
//
// The drain-signs suite is still the oracle for the town's cryptography and is
// not replaced here. This file guards the narrower thing drain-signs cannot: the
// COPY agreeing with the original.
//
// Two readers, because they fail on different days. The literal cases below run
// everywhere and never skip — the repo's own "keep them literal" rule for copied
// town grammar (src/funding.mjs § THE FUNDING SEAM). The cross-check runs the
// real engine side by side whenever a town checkout is reachable, and SKIPS
// rather than passes when it is not: a silent pass on a box that cannot reach
// the oracle is the check reaching for something easier than the behaviour.

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import "./helpers/drain-pen.mjs"; // side effect: STAMP_KEY + STAMP_ENGINE_DIR

const OFFICE = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = await import(pathToFileURL(join(process.env.STAMP_ENGINE_DIR, "stamp-mint.mjs")).href);

// ── the shapes, and what the town engine actually answers for each ───────────
//
// Measured against tools/stamp-mint.mjs, not guessed. The three marked (was a
// divergence) are the ones a trimming parser gets wrong, and two of them get it
// wrong in the dangerous direction: they read a malformed line as SIGNED.
const SHAPES = [
  ["a signed entry", "- a b c · sig: AAA",
    [{ canonical: "- a b c", sig: "AAA", raw: "- a b c · sig: AAA" }]],
  ["an unsigned entry", "- a b c",
    [{ canonical: "- a b c", sig: null, raw: "- a b c" }]],
  ["prose is not an entry", "some prose", []],
  // (was a divergence) The signature runs to the end of the line. A trailing
  // space means this line is NOT signed, and the verifier is the one that flags
  // it — a fixture that trims reports a signature nobody made.
  ["a trailing space un-signs the line", "- a b c · sig: AAA ",
    [{ canonical: "- a b c · sig: AAA ", sig: null, raw: "- a b c · sig: AAA " }]],
  // (was a divergence) An indented line is not an entry at all.
  ["a leading space is not an entry", "  - a b c · sig: AAA", []],
  // (was a divergence) An empty signature is no signature, and the raw line
  // keeps its own bytes.
  ["an empty signature is no signature", "- a b c · sig: ",
    [{ canonical: "- a b c · sig: ", sig: null, raw: "- a b c · sig: " }]],
  // The LAST marker wins, so a canonical line may itself contain one.
  ["the last marker wins", "- a · sig: X · sig: AAA",
    [{ canonical: "- a · sig: X", sig: "AAA", raw: "- a · sig: X · sig: AAA" }]],
  ["CRLF is normalised", "- one · sig: A\r\n- two · sig: B",
    [{ canonical: "- one", sig: "A", raw: "- one · sig: A" },
     { canonical: "- two", sig: "B", raw: "- two · sig: B" }]],
];

test("the fixture parser answers the town's grammar on every shape, trimming none of them", () => {
  for (const [name, input, expected] of SHAPES) {
    assert.deepEqual(FIXTURE.parseStampLedger(input), expected,
      `${name}: the fixture engine must answer exactly what tools/stamp-mint.mjs answers`);
  }
});

test("the fixture seal chain is the town's: seal_0 = sha256(\"postmark-stamps-v1\"), seal_n = sha256(seal_n-1 + canonical_n)", () => {
  // The law quoted in test/drain-signs.test.mjs, recomputed here from the seed
  // rather than from the fixture, so agreeing with itself is not enough.
  const seed = "postmark-stamps-v1";
  const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
  const canonicals = ["- one", "- two", "- three"];
  let seal = sha(seed);
  const expected = canonicals.map((c) => (seal = sha(seal + c)));
  assert.deepEqual(FIXTURE.sealChain(canonicals), expected);
  assert.deepEqual(FIXTURE.sealChain([]), [],
    "an empty chain has no seals — the genesis seed is never itself a seal");
});

// ── THE CROSS-CHECK · the copy beside the original ──────────────────────────
//
// Resolved the way the office itself resolves a town clone (TOWN_CLONE, else
// <office>/town-clone), never a literal developer path — the thing this whole
// change is removing. Absent, this SKIPS.
const TOWN = process.env.TOWN_CLONE ?? join(OFFICE, "town-clone");
const REAL_MINT = join(TOWN, "tools", "stamp-mint.mjs");
const HAVE_REAL = existsSync(REAL_MINT);

test("the fixture engine and the town's own engine answer identically", { skip: !HAVE_REAL && `no town engine at ${REAL_MINT}` }, async () => {
  const REAL = await import(pathToFileURL(REAL_MINT).href);
  for (const [name, input] of SHAPES) {
    assert.deepEqual(FIXTURE.parseStampLedger(input), REAL.parseStampLedger(input),
      `${name}: the fixture engine has drifted from tools/stamp-mint.mjs`);
  }
  const canonicals = ["- one", "- two", "- three"];
  assert.deepEqual(FIXTURE.sealChain(canonicals), REAL.sealChain(canonicals));
});

// ONE HOUSEHOLD, ONE MINT KEY (2026-10-04): the fixture's current-keys fold and
// its household-keys predicate, read back against the town's own on the LIVE
// town clone (every pin, room and registry line the town has), and again with
// one line folded that moves a real resident off its house key, so the
// comparison includes a split and not only a clean town.
const REAL_KEYS = join(TOWN, "tools", "household-keys.mjs");
test("the fixture's household fold and predicate answer as the town's do, on the live town", { skip: !existsSync(REAL_KEYS) && `no town predicate at ${REAL_KEYS}` }, async () => {
  const REAL = await import(pathToFileURL(REAL_MINT).href);
  const REALK = await import(pathToFileURL(REAL_KEYS).href);
  const FIXK = await import(pathToFileURL(join(process.env.STAMP_ENGINE_DIR, "household-keys.mjs")).href);
  const real = REAL.currentHouseholds(TOWN), fix = FIXTURE.currentHouseholds(TOWN);
  assert.deepEqual(Object.fromEntries([...fix].map(([h, v]) => [h, v.key])), Object.fromEntries([...real].map(([h, v]) => [h, v.key])));
  const houses = REALK.readHouses(TOWN);
  // a split, by folding a line that moves one resident of a real house off its key
  const [slug, rec] = Object.entries(houses).find(([, r]) => (r.residents ?? []).length > 1);
  const extra = [`- 2026-12-31 · registry: ${rec.residents[0]} = gh:0`];
  for (const lines of [[], extra]) {
    assert.deepEqual(FIXK.describe(FIXK.householdKeySplits({ roll: FIXK.rollWith(fix, lines), houses })),
      REALK.describe(REALK.householdKeySplits({ roll: REALK.rollWith(real, lines), houses })));
  }
  assert.match(FIXK.describe(FIXK.householdKeySplits({ roll: FIXK.rollWith(fix, extra), houses })).join("\n"), new RegExp(`${slug} mints under 2 keys`));
});
