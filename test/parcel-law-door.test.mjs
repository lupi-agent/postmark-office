// parcel-law-door.test.mjs — THE OFFICE SPEAKS THE WORLD'S PARCEL LAW (Darko, 2026-10-04; Linear POS-368).
//
// "One parcel per resident, three per household. Yes." The law marks live in
// the world (the-town/claim-cap, the-town/one-per-resident) and so does the
// sentence (postmark-world tools/marks-fold.mjs § ONE_PER_RESIDENT_REFUSAL).
// The office's doors refuse the same claim one step earlier, with the same
// words: src/parcel-law.mjs hands back the fold's own constant when the clone
// carries it, and its copy only when it does not. This file holds the copy
// byte-equal to the world's, so the two cannot drift silently.
//
// The world constant ships with postmark-world #143. Until the pinned clone
// carries it, the equality skips BY NAME; point WORLD_LAW_CLONE at a world tree
// that has it (e.g. a pool tree on pos-368/parcel-law) to run it now.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ONE_PER_RESIDENT_SENTENCE, ONE_PER_RESIDENT_LAW, CLAIM_CAP_LAW,
  onePerResidentDefect, onePerResidentHint, capHint, residentParcels, isPriorEstate,
} from "../src/parcel-law.mjs";

const LAW_CLONE = process.env.WORLD_LAW_CLONE || process.env.WORLD_CLONE || "";
const foldPath = LAW_CLONE ? join(LAW_CLONE, "tools", "marks-fold.mjs") : "";
const fold = foldPath && existsSync(foldPath) ? await import(pathToFileURL(foldPath).href).catch(() => null) : null;
const hasLaw = typeof fold?.ONE_PER_RESIDENT_REFUSAL === "string";

test(`the office's copy of the one-per-resident sentence IS the world's${hasLaw ? "" : " (SKIPPED: the world clone predates postmark-world #143 — set WORLD_LAW_CLONE)"}`,
  { skip: !hasLaw }, () => {
    assert.equal(ONE_PER_RESIDENT_SENTENCE, fold.ONE_PER_RESIDENT_REFUSAL, "byte for byte");
    assert.equal(ONE_PER_RESIDENT_LAW, fold.ONE_PER_RESIDENT_LAW);
    assert.equal(CLAIM_CAP_LAW, fold.CLAIM_CAP_LAW);
    assert.equal(onePerResidentDefect(fold), fold.ONE_PER_RESIDENT_REFUSAL, "and the door hands back the fold's own");
    assert.equal(isPriorEstate(fold, "sol-am-lichterfenster/driftlight-house-parcel"), true, "Driftlight is prior estate, by the fold's own map");
  });

test("the sentence is Darko's and names its law; an old clone falls back to the copy", () => {
  assert.ok(ONE_PER_RESIDENT_SENTENCE.startsWith("this resident already holds a parcel; a household may hold up to three, one per resident"));
  assert.ok(ONE_PER_RESIDENT_SENTENCE.includes("the-town/one-per-resident"));
  assert.equal(onePerResidentDefect({}), ONE_PER_RESIDENT_SENTENCE, "a clone with no constant");
  assert.equal(onePerResidentDefect(null), ONE_PER_RESIDENT_SENTENCE);
  assert.doesNotMatch(ONE_PER_RESIDENT_SENTENCE, /—/, "no em dash: the receipt groups a refusal by the text before one");
});

test("the hints: the cap names both laws and keeps the phrase the door's falsifiers read; the per-resident hint names the parcel held", () => {
  assert.match(capHint(3, "2026-07-30"), /capped at 3 per household, one per resident \(the-town\/claim-cap, ruled 2026-07-30/);
  assert.match(onePerResidentHint("ash/the-roost-parcel"), /^you hold ash\/the-roost-parcel — to move your ground, amend that parcel/);
});

test("a resident's parcels are their own, never a housemate's, and never the one being written", () => {
  const marks = [
    { id: "ash/one", kind: "parcel", by: "ash" },
    { id: "birch/two", kind: "parcel", by: "birch" },
    { id: "ash/a-shed", kind: "sited", by: "ash" },
    { id: "ash/no-by-field", kind: "parcel" },
  ];
  assert.deepEqual(residentParcels(marks, "ash").map((m) => m.id), ["ash/one", "ash/no-by-field"]);
  assert.deepEqual(residentParcels(marks, "ash", "ash/one").map((m) => m.id), ["ash/no-by-field"]);
  assert.deepEqual(residentParcels(marks, "elm"), []);
});

test("[pin] both doors refuse a second parcel per resident, after the cap, sparing an amend and prior estate", () => {
  const world = readFileSync(new URL("../src/world.mjs", import.meta.url), "utf8");
  assert.match(world, /if \(!amending && theirs\.length && !isPriorEstate\(fold, id\)\)\n\s*throw bounce\(409, onePerResidentDefect\(fold\), onePerResidentHint\(theirs\[0\]\.id\)\);/);
  assert.ok(world.indexOf("capHint(cap,") < world.indexOf("onePerResidentDefect(fold)"), "the cap speaks first (its falsifiers read 403 for a household at the cap)");
  const exec = readFileSync(new URL("../src/leave-exec.mjs", import.meta.url), "utf8");
  assert.match(exec, /if \(theirs\.length && !isPriorEstate\(foldMod, id\)\)\n\s*return err\(409, onePerResidentDefect\(foldMod\), onePerResidentHint\(theirs\[0\]\.id\)\);/);
});

test("[pin] the home block answers per resident: via, parcel_id, home_mark ride beside the four keys", () => {
  const world = readFileSync(new URL("../src/world.mjs", import.meta.url), "utf8");
  for (const field of ["via: home.via", "parcel_id: home.parcel_id", "home_mark: home.home_mark", "declaration: home.declaration"])
    assert.ok(world.includes(field), `worldBlockForHandle carries ${field}`);
  assert.match(world, /return \{ mark_id: home\.mark_id, x: home\.x, y: home\.y, sited: true,/, "the four keys are unchanged");
});
