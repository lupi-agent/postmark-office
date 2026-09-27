// settlement-receipt-refused.test.mjs — THE RECEIPT NAMES WHAT THE SWEEP REFUSED.
//
// ── THE INSTANCE, MEASURED ON THE BOX ────────────────────────────────────────
//
// S71's own history row, from /srv/postmark-harbor/settlement-auto-history.jsonl:
//
//   {"at":"2026-09-15T17:45:00Z","status":"published","class":null,
//    "published":16,"left_drafted":0,"quarantined":1,"retired":0,
//    "world_from":"49bd1829…","world_to":"3a3a645c…"}
//
// A crossing that PUBLISHED, with one sketchbook set aside. Reproduced against
// `deploy/settlement-receipt.mjs` at the train tip, the receipt carried:
//
//   status  "published"      detail  "16 published"
//   class   null             refusal null
//   quarantined [{ household: "mari", ref: "draft/mari",
//                  reason: "this sketchbook's own published rows could not be
//                           admitted, so it was set aside and the rest of the
//                           town settled without it",
//                  row: null }]
//
// The cause — `mari/marigold-house-parcel`, "parcel claim capped … already holds
// 5 (cap 3 …)" — was in the sweep's `detail`, which the composer dropped. `row`
// is null because `firstStakeRowIn` matches `{"stake":…}` and a parcel cap error
// carries no stake row. The world's own `PARCEL_CAP_EXCEPTIONS` entry for Mari
// records the consequence in one clause: "the public receipt hid the sentence
// (`row: null`), so the store stood the parcel while canon lacked it."
//
// ── WHAT THESE FALSIFIERS HOLD ──────────────────────────────────────────────
//
// Each one drives the receipt through its real entry point — `execFileSync` on
// the script with the env `settlement-auto.sh § report` sets — so a fixture can
// never pass by calling a function the crossing does not call.
//
// The one to read first is the CLEAN one: a crossing that refused nothing must
// be byte-identical to what it was before this block existed, because every
// consumer downstream (the escalation body, the keeper's read, the site's
// settlements pane) reads this file's output and none of them asked for a new
// key on an ordinary night.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { foldErrorIn, checkOf, inadmissibleClaimed, refusedMarks, REFUSED_MARKS_SHOWN }
  from "../deploy/refused-marks.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RECEIPT = join(ROOT, "deploy", "settlement-receipt.mjs");

/** The sweep's own sentence for Mari's parcel, verbatim from marks-fold.mjs. */
const CAP_SENTENCE =
  "parcel claim capped — this credential household already holds 5 " +
  "(cap 3 per household, ruled 2026-07-30; prior estate stands, new claims wait on the founder's word)";

/** A quarantined row exactly as settlement-sweep.mjs:1160-1166 composes one. */
function quarantine(household, mark, error, { rows = 1 } = {}) {
  const branch = `draft/${household}`;
  const detail = `${branch} publishes ${rows} inadmissible row(s): ${JSON.stringify({ mark, error })}`;
  return {
    household, ref: branch,
    reason: "this sketchbook's own published rows could not be admitted, so it was set aside and the rest of the town settled without it",
    detail: detail.slice(0, 400),
    row: null,   // firstStakeRowIn finds no {"stake":…} in a fold error
  };
}

const CHANNELS = ["published", "unpublished", "left_drafted", "withdrawn", "quarantined", "suite_quarantined", "dropped", "rebased"];
const emptySweep = (over = {}) => ({
  ...Object.fromEntries(CHANNELS.map((c) => [c, []])),
  surveyed: { branches: 5, delta_rows: 17, escrow_backed_deltas: 3 },
  ...over,
});

/** Compose a receipt the way settlement-auto.sh's `report` function does. */
function compose({ sweep = emptySweep(), refusal = undefined, status = "published", detail = "16 published" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "receipt-refused-"));
  try {
    const env = {
      ...process.env,
      SETTLEMENT_STATUS: status,
      SETTLEMENT_DETAIL: detail,
      SETTLEMENT_AT: "2026-09-15T17:45:00Z",
      SETTLEMENT_SOURCE_MODE: "store",
      SETTLEMENT_TOWN_SHA: "5392664e1aa0f6e2f1e0f4a1a1f0c2d3e4f5a6b7",
      SETTLEMENT_WORLD_FROM: "49bd1829b8ebef37ef12428b3412982145b8af92",
      SETTLEMENT_WORLD_TO: "3a3a645c2c5411f0426fd045efcb3f2ea36e1611",
    };
    for (const k of ["SETTLEMENT_REFUSAL_JSON", "SETTLEMENT_STORE_JSON", "SETTLEMENT_DRAIN_JSON",
                     "SETTLEMENT_RETIRE_JSON", "SETTLEMENT_ISOLATE_JSON", "SETTLEMENT_HARM_JSON",
                     "SETTLEMENT_SUITE_JSON", "SETTLEMENT_REGISTRY_JSON"]) delete env[k];
    const sweepPath = join(dir, "sweep.json");
    writeFileSync(sweepPath, JSON.stringify(sweep));
    env.SETTLEMENT_SWEEP_JSON = sweepPath;
    if (refusal !== undefined) {
      const p = join(dir, "refusal.json");
      writeFileSync(p, JSON.stringify(refusal));
      env.SETTLEMENT_REFUSAL_JSON = p;
    }
    return JSON.parse(execFileSync(process.execPath, [RECEIPT], { encoding: "utf8", env }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("THE INSTANCE: the S71 receipt names Mari's mark, her household and the cap's own sentence", () => {
  const r = compose({ sweep: emptySweep({ quarantined: [quarantine("mari", "mari/marigold-house-parcel", CAP_SENTENCE)] }) });

  // The crossing still says what it was — this was never a refusal, which is
  // exactly why a refusal-only surface would have missed it.
  assert.equal(r.status, "published");
  assert.equal(r.class, null);
  assert.equal(r.refusal, null);

  assert.equal(r.refused.named, 1);
  assert.equal(r.refused.claimed, 1);
  const [m] = r.refused.marks;
  assert.equal(m.mark, "mari/marigold-house-parcel", "the mark id is the thing a resident searches for");
  assert.equal(m.household, "mari");
  assert.equal(m.ref, "draft/mari");
  assert.equal(m.check, "parcel claim capped", "the refusing check, sliced from the sweep's own sentence");
  assert.equal(m.error, CAP_SENTENCE, "the whole sentence, not its head — the numbers live in the tail");

  // The three things the operator could not read before, each present.
  assert.match(m.error, /already holds 5/);
  assert.match(m.error, /cap 3 per household/);
  assert.match(m.error, /ruled 2026-07-30/);
});

test("THE BRIEF'S FALSIFIER: two refused marks are BOTH named, by id, with their sentences", () => {
  const other = "parcel overlaps histor-reeves/the-gauge-house-parcel — inadmissible (MARKS.md § Parcels)";
  const r = compose({ sweep: emptySweep({ quarantined: [
    quarantine("mari", "mari/marigold-house-parcel", CAP_SENTENCE),
    quarantine("lupi", "lupi/the-drift-room-parcel", other),
  ] }) });

  assert.equal(r.refused.named, 2);
  assert.equal(r.refused.claimed, 2);
  assert.deepEqual(r.refused.marks.map((m) => m.mark),
    ["mari/marigold-house-parcel", "lupi/the-drift-room-parcel"]);
  assert.deepEqual(r.refused.marks.map((m) => m.error), [CAP_SENTENCE, other]);
  assert.deepEqual(r.refused.marks.map((m) => m.check), ["parcel claim capped", "parcel overlaps histor-reeves/the-gauge-house-parcel"]);
  assert.equal(r.channels.quarantined, 2, "the channel counts stay");
});

test("THE BRIEF'S CONTROL: a clean report leaves the receipt exactly as it was", () => {
  const r = compose();
  assert.equal("refused" in r, false,
    "an ordinary crossing refused nothing, so there is no answer to carry; channels.quarantined already says 0");
  assert.equal(r.channels.quarantined, 0);

  // The whole key set, frozen against the composer at the train tip (d2e01f0cc).
  // A new key on an ordinary night reaches every consumer downstream, so the
  // list is asserted rather than the one field: adding a second key quietly is
  // the same defect as adding this one.
  //
  // `state_log` joined it on 2026-09-22 (POS-155), and this guard is what made
  // that a decision rather than a side effect — it went red on the commit that
  // added the channel, which is the whole reason it is a list.
  assert.deepEqual(Object.keys(r), [
    "at", "status", "town_sha", "world_from", "world_to", "source", "by_hand",
    "sketchbook_ghosts", "sketchbook_kept_undelivered", "sketchbook_resets",
    "as_of", "drain", "store", "state_log", "registry", "surveyed", "surveyed_reading",
    "retired", "channels", "quarantined", "isolated", "harm", "suite",
    "class", "next_step", "refusal", "detail",
  ]);

  // AND ON AN ORDINARY CROSSING IT SAYS THE STEP DID NOT RUN, rather than
  // being absent. `ran: false` and a missing key read the same to a human and
  // differently to every consumer downstream — which is the distinction this
  // channel exists to make about the archive in the first place.
  assert.deepEqual(r.state_log, { ran: false });
});

test("a FOLD REFUSAL's cause names its mark too — the other half of the same grammar", () => {
  // settlement-sweep.mjs:315-316 throws `${ref} folds with N error(s): {JSON}`,
  // and settlement-classify forwards that string as `cause`. The classify
  // verdict carries `errors_claimed`/`errors_seen` and never the rows, so
  // without this arm a whole-crossing fold refusal names no mark either.
  const cause = `origin/main folds with 1 error(s): ${JSON.stringify({ mark: "mari/marigold-house-parcel", error: CAP_SENTENCE })}`;
  const r = compose({
    status: "refused",
    detail: "sweep tripped: settlement sweep refused: origin/main folds with 1 error(s)",
    refusal: { class: "canon-bad", next_step: "a person edits the record", cause, ref: "origin/main", errors_claimed: 1, errors_seen: 1 },
  });

  assert.equal(r.class, "canon-bad", "the refusal's own class is untouched");
  assert.equal(r.refused.named, 1);
  assert.equal(r.refused.marks[0].mark, "mari/marigold-house-parcel");
  assert.equal(r.refused.marks[0].household, null,
    "a fold refusal names a TREE, not a sketchbook — guessing the household from the id's prefix would be this side resolving identity");
  assert.equal(r.refused.marks[0].ref, "origin/main");
});

test("the sweep forwards ONE error per message, and the receipt says so instead of implying four", () => {
  const r = compose({ sweep: emptySweep({ quarantined: [
    quarantine("mari", "mari/marigold-house-parcel", CAP_SENTENCE, { rows: 4 }),
  ] }) });
  assert.equal(r.refused.claimed, 4, "the sweep's own count");
  assert.equal(r.refused.named, 1, "and all it forwarded");
  assert.match(r.refused.withheld, /reported 4 inadmissible row\(s\)/);
  assert.match(r.refused.withheld, /FIRST error per message/);
});

test("a quarantine this parser cannot read is NAMED, not dropped", () => {
  // Unreachable against today's sweep — it has one quarantine site and it always
  // carries the fold's grammar. This is the arm that decides what happens the
  // day it grows a second one, and silently skipping would rebuild the omission
  // inside the fix.
  const r = compose({ sweep: emptySweep({ quarantined: [
    { household: "nobody", ref: "draft/nobody", reason: "set aside", detail: "a shape this file has no grammar for", row: null },
  ] }) });
  assert.equal(r.refused.named, 0);
  assert.deepEqual(r.refused.unparsed, [{ household: "nobody", ref: "draft/nobody" }]);
});

// ── the parser's own falsifiers, driven directly ─────────────────────────────

test("FALSIFIER: the cap's sentence survives its commas — a hand-rolled scrape would cut it at the first one", () => {
  const row = foldErrorIn(`draft/mari publishes 1 inadmissible row(s): ${JSON.stringify({ mark: "m/p", error: CAP_SENTENCE })}`);
  assert.equal(row.error, CAP_SENTENCE);
  assert.match(row.error, /founder's word\)$/, "the tail is where the ruling date and the remedy are");
});

test("FALSIFIER: a message with no fold error yields null rather than a half-built row", () => {
  assert.equal(foldErrorIn("draft/x publishes 2 inadmissible row(s): something else"), null);
  assert.equal(foldErrorIn(""), null);
  assert.equal(foldErrorIn(null), null);
  assert.equal(inadmissibleClaimed("nothing numeric here"), null);
});

test("FALSIFIER: both of the sweep's two phrasings are counted, because they are one grammar", () => {
  assert.equal(inadmissibleClaimed("draft/mari publishes 3 inadmissible row(s): {}"), 3);
  assert.equal(inadmissibleClaimed("origin/main folds with 7 error(s): {}"), 7);
});

test("FALSIFIER: `check` is a slice of the sweep's words and invents none of its own", () => {
  assert.equal(checkOf(CAP_SENTENCE), "parcel claim capped");
  assert.equal(checkOf("duplicate id"), "duplicate id", "a sentence with no em dash is its own head");
  assert.equal(checkOf("household already holds a parcel (relocation = replace, not add)"),
    "household already holds a parcel (relocation = replace, not add)");
  assert.equal(checkOf(""), null);
});

test("FALSIFIER: the named list is capped and the total stays exact", () => {
  const many = Array.from({ length: REFUSED_MARKS_SHOWN + 5 }, (_, i) =>
    ({ household: `h${i}`, ref: `draft/h${i}`, reason: "set aside",
       detail: `draft/h${i} publishes 1 inadmissible row(s): ${JSON.stringify({ mark: `h${i}/p`, error: CAP_SENTENCE })}` }));
  const out = refusedMarks({ quarantined: many }, null);
  assert.equal(out.claimed, REFUSED_MARKS_SHOWN + 5, "the total is never the cap");
  assert.equal(out.named, REFUSED_MARKS_SHOWN + 5);
  assert.equal(out.marks.length, REFUSED_MARKS_SHOWN);
  assert.equal(out.shown, REFUSED_MARKS_SHOWN);
});

test("FALSIFIER: no quarantine and no refusal is NULL, not an empty block", () => {
  assert.equal(refusedMarks(emptySweep(), null), null);
  assert.equal(refusedMarks(null, null), null);
});
