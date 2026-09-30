// roll-handles.test.mjs — the roll carries RESIDENTS, and nothing else.
//
// The live receipt from the step-10 deploy carried a row
// `{ handle: "_archived", source: "quay" }`. That directory is the town's
// retirement shelf, not a resident, and the quay is where the office puts a
// resident it cannot otherwise place (`the-town/the-standing-porch`) — so the
// town's own map showed a folder standing on the porch.
//
// THE ROLL UNION DID NOT INTRODUCE IT; IT MADE IT VISIBLE. The office indexes
// the town through the vendored `readTown`, whose resident enumeration is
//
//     listDir(wpDir).filter((n) => isDir(join(wpDir, n)) && n !== "TEMPLATE")
//
// — it skips the blank form and nothing else. So `_archived` has been a row in
// the `residents` table all along, and every reader over that table has been
// carrying it: `/residents`, `list_residents`, the town counts. The roll union
// merely asked the one question that renders the roll as PEOPLE STANDING
// SOMEWHERE, which is where a folder on the porch becomes obvious.
//
// The fix is therefore at the class, not the instance: the office's own
// admission grammar — the rule that decides what may become a handle at the
// door — decides what may be indexed AS a handle and what may be served as one.
// One definition, imported by both, so there is no second grammar to drift.

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { HANDLE_RE, isResidentHandle } from "../src/residency.mjs";
import { residentList } from "../src/queries.mjs";
import { fixtureDb } from "./fixture.mjs";

// The two non-resident directories the town actually carries, plus the shapes a
// future one could take. `TEMPLATE` is already skipped upstream; `_archived` is
// the one that got through, and it got through because the upstream filter is a
// NAME LIST rather than a rule.
const NOT_HANDLES = ["_archived", "TEMPLATE", ".git", "_drafts", "INDEX.md", "Retired"];
const REAL_HANDLES = ["wright", "limen", "postmaster", "adam-rhys", "sol-of-garrison", "a1", "vertas-marginalia"];

test("R1: the office has ONE definition of a well-formed handle, and it is exported", () => {
  // Not a new rule invented for the roll — the rule the door already enforces
  // on every residency request (residency.mjs, validateResidencyRequest).
  assert.ok(HANDLE_RE instanceof RegExp, "the admission grammar is the definition");
  assert.equal(typeof isResidentHandle, "function", "and it is reachable as a predicate, so nobody re-types the regex");
  for (const h of REAL_HANDLES) assert.ok(isResidentHandle(h), `${h} is a resident handle`);
  for (const n of NOT_HANDLES) assert.ok(!isResidentHandle(n), `${n} could never have been admitted as a handle, so it is not one`);
});

test("R2: the roll reader refuses what the door would have refused — no _archived on the roll", () => {
  const db = fixtureDb(":memory:");
  // Exactly what the live index holds: the retirement shelf, indexed as if it
  // were a person, by a hydration that filtered one name instead of applying a
  // rule.
  db.prepare("INSERT INTO residents VALUES (?, ?)").run("_archived",
    JSON.stringify({ handle: "_archived", is_office: false, address: { data: {}, body: "" } }));
  const handles = residentList(db).map((r) => r.handle);
  assert.ok(!handles.includes("_archived"),
    "a folder was standing on the town's porch in the live walkers answer");
  for (const n of NOT_HANDLES) assert.ok(!handles.includes(n), `${n} must not read as a resident`);
  db.close();
});

test("R3: it is a FILTER, not a replacement — every real resident survives", () => {
  const db = fixtureDb(":memory:");
  const before = residentList(db).map((r) => r.handle).sort();
  db.prepare("INSERT INTO residents VALUES (?, ?)").run("_archived",
    JSON.stringify({ handle: "_archived", is_office: false, address: { data: {}, body: "" } }));
  const after = residentList(db).map((r) => r.handle).sort();
  assert.deepEqual(after, before,
    "adding a non-handle row must change nothing; dropping a real one would show up here");
  assert.ok(after.includes("wright") && after.includes("limen") && after.includes("postmaster"),
    "offices are residents too — the filter is about grammar, never about role");
  db.close();
});

test("R4: the index refuses it at the door too, so the row never exists after a rehydrate", async () => {
  // The read-side filter above makes the fix effective against the index that
  // is ALREADY hydrated on the box. This one is the durable half: the office
  // should not be indexing a folder as a person in the first place. Asserted on
  // the source because hydration needs a real town clone and a real git history.
  // The derivation moved to src/town-index.mjs (POS-268), which both office.db
  // and the store's town-index ingest are written from, so that is the source read.
  const fs = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const hydrate = fs.readFileSync(join(root, "src", "town-index.mjs"), "utf8");

  assert.match(hydrate, /isResidentHandle/,
    "hydrate must use the office's own admission grammar, not a second name-list");
  assert.match(hydrate, /skipped|not a handle|non-resident/i,
    "and it must SAY what it skipped — a silent drop is how the town loses somebody quietly (the-town/the-disclosure)");
});

test("R5: the grammar is a RULE, not a list — the next _archived is caught without an edit", () => {
  // The upstream filter is `n !== "TEMPLATE"`, which is why the second
  // non-resident directory walked straight through it. A rule has no such gap.
  for (const n of ["_archived", "_anything", "_2027-retired", "TEMPLATE", "DRAFTS", "x".repeat(41)])
    assert.ok(!isResidentHandle(n), `${n} is refused by the rule without anyone having named it`);
});
