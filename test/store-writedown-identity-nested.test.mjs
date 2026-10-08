// store-writedown-identity-nested.test.mjs — A MARK NESTED IN THE IDENTITY TREE
// IS WRITTEN IN ITS PARENT'S FRAME (POS-446, 2026-10-08).
//
// The world's loader frames a `mark.md` on the mark whose directory holds it,
// in either layout. The write-down's nested test knew only the fossil root
// (`WORLD/marks/let-there-be-light/<a>/<b>/`), so a mark filed under an
// id-keyed parent (`WORLD/marks/<household>/<slug>/<child>/`) was written with
// the store's WORLD numbers raw into a parent-relative file. After the household
// un-nesting (world 857dc401, 2026-10-07) 189 marks are filed that way, and 64
// of their parents are in no freeze-manifest row.
//
// THE LIVE CASE, reproduced on a scratch clone of world main 078d68b0 with the
// train's write-down and lupi's own store row (act 7470): the file was written
// `at: { x: -1408, y: -3032 }` under her parcel, and the fold put the step at
// (-2813, -6075), 3.4 km from her den.
//
//   · the nested test names both layouts, one function for the write-down and
//     the drain;
//   · the framer resolves an id-keyed ancestor the manifest does not name, by
//     its own `by:` at main;
//   · the plan frames lupi's row to the file's own (-3, 11), and the world's
//     own fold over the sketchbook keeps the step where it stood.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { fileFramer } from "../src/world-drain.mjs";
import { isNestedFiling } from "../src/world-journal.mjs";
import { normalizeMark, planStoreWriteDown, storeWriteDown } from "../src/store-writedown.mjs";
import { renderedMark } from "../world2/tools/mark-render.mjs";

const OFFICE = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORLD = [process.env.POSTMARK_WORLD_CLONE, process.env.WORLD_CLONE, join(OFFICE, "world-clone"), join(OFFICE, "..", "postmark-world")]
  .filter(Boolean).find((c) => existsSync(join(c, "tools", "marks-fold.mjs"))) ?? null;
const WHY_SKIP = WORLD ? false : "no world checkout found (set POSTMARK_WORLD_CLONE) — this file needs the real loader";

const PARCEL_FILE = "WORLD/marks/lupi/the-den-parcel/mark.md";
const STEP_FILE = "WORLD/marks/lupi/the-den-parcel/the-step/mark.md";
const PARCEL_WORLD = { x: -1405, y: -3043 };   // root-framed: the file's number is the world's
const STEP_WORLD = { x: -1408, y: -3032 };     // what the store holds, and what the resident spoke
const STEP_FILE_AT = { x: -3, y: 11 };         // the offset from the parcel: what the file must say
const MOVED_TO = { x: -2813, y: -6075 };       // the parcel + the world number: where the raw carriage put it

// lupi's row as the store holds it after act 7470 (read-only, world2_dev, 2026-10-08), renamed onto the fixture.
const STORE_ROW = {
  slug: "lupi/the-step", kind: "sited", owner: "lupi", household: "gh:312847595", locked_window: 207, status: "standing",
  geometry: { at: { ...STEP_WORLD }, slug: "lupi/the-step", extent: { h: 1, w: 2 } },
  data: { by: "lupi", date: "2026-09-23T06:15:55.041Z", kind: "sited", tier: "home", _act_id: "7470", _journal_seq: null },
  body: "8 Aug: no visitor's tread yet, only the light waiting. Kept as written, the Drift Room's first card. It has been crossed since.",
};
const entryFor = (row) => ({
  slug: row.slug, kind: row.kind, by: row.owner, household: row.household, locked_window: row.locked_window,
  status: row.status, founder_commit: null, ...renderedMark(row),
});
const rec = (fields, body) => `---\n${fields.join("\n")}\n---\n\n${body}\n`;

function identityWorld(t) {
  const repo = mkdtempSync(join(tmpdir(), "postmark-storewd-idnest-"));
  t.after(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* litter */ } });
  const put = (p, text) => { mkdirSync(join(repo, dirname(p)), { recursive: true }); writeFileSync(join(repo, p), text); };
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  cpSync(join(WORLD, "tools"), join(repo, "tools"), { recursive: true });
  put("package.json", JSON.stringify({ name: "world-fixture", type: "module" }));
  put("WORLD/skeleton.json", `${JSON.stringify({ features: [], physics_registry: {} }, null, 2)}\n`);
  put("WORLD/households.json", `${JSON.stringify({ households: { lupi: "gh:312847595" }, logins: { "lupi-agent": "gh:312847595" } }, null, 2)}\n`);
  put("WORLD/marks/let-there-be-light/mark.md", rec(["kind: sited", "by: the-town", "tier: constitution", "date: 2026-07-22",
    "at: { x: 0, y: 0 }", "extent: { w: 320000, h: 320000 }", "coords: relative"], "Let there be light."));
  put(PARCEL_FILE, rec(["by: lupi", "kind: parcel", "date: 2026-08-07", `at: { x: ${PARCEL_WORLD.x}, y: ${PARCEL_WORLD.y} }`,
    "extent: { w: 25, h: 25 }"], "The ground the den stands on."));
  put(STEP_FILE, rec(["kind: sited", "by: lupi", "date: 2026-08-08", `at: { x: ${STEP_FILE_AT.x}, y: ${STEP_FILE_AT.y} }`,
    "extent: { w: 2, h: 1 }"], "The ground past my threshold sits unworn still."));
  // A freeze manifest that names neither: the parcel was born at its id and given a child later.
  put("WORLD/filing-freeze.json", `${JSON.stringify({ frozen_at: "2026-08-25", marks: {} }, null, 2)}\n`);
  git("init", "-q", "-b", "main");
  execFileSync(process.execPath, [join(repo, "tools", "marks-fold.mjs")], { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
  git("add", "-A");
  git("-c", "user.name=fixture", "-c", "user.email=f@t.invalid", "commit", "-q", "-m", "canon");
  return { repo, git };
}

function stepAt({ repo, git }, ref) {
  const dir = mkdtempSync(join(tmpdir(), "postmark-storewd-idnest-fold-"));
  try {
    cpSync(join(WORLD, "tools"), join(dir, "tools"), { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "world-fixture", type: "module" }));
    for (const p of git("ls-tree", "-r", "--name-only", ref, "--", "WORLD").trim().split("\n").filter(Boolean)) {
      mkdirSync(join(dir, dirname(p)), { recursive: true });
      writeFileSync(join(dir, p), git("show", `${ref}:${p}`));
    }
    execFileSync(process.execPath, [join(dir, "tools", "marks-fold.mjs")], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    const m = JSON.parse(readFileSync(join(dir, "WORLD", "world-state.json"), "utf8")).marks.find((x) => x.id === "lupi/the-step");
    return m ? { at: m.at, parent: m.placementParent ?? null } : null;
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch { /* litter */ } }
}

test("isNestedFiling: deeper than a household's own mark is nested, in both layouts", () => {
  assert.equal(isNestedFiling("WORLD/marks/let-there-be-light/mark.md"), false, "the root");
  assert.equal(isNestedFiling("WORLD/marks/let-there-be-light/the-town-centre/mark.md"), false, "the fossil root's child is root-framed");
  assert.equal(isNestedFiling("WORLD/marks/let-there-be-light/the-town-centre/le-petit-berthillon/mark.md"), true, "a fossil grandchild, as before");
  assert.equal(isNestedFiling(PARCEL_FILE), false, "a household's own mark is root-framed");
  assert.equal(isNestedFiling(STEP_FILE), true, "a mark under an id-keyed parent is framed on it");
  assert.equal(isNestedFiling(null), false);
});

test("the framer resolves an id-keyed parent the manifest does not name", { skip: WHY_SKIP }, async (t) => {
  const { repo } = identityWorld(t);
  const toFileFrame = await fileFramer(repo);
  assert.deepEqual(toFileFrame({ at: STEP_WORLD, path: STEP_FILE }), { at: STEP_FILE_AT }, "framed on the parcel, by its own `by:` at main");
  assert.equal(toFileFrame.declaredParentOf(STEP_FILE)?.parentId, "lupi/the-den-parcel", "and the declared-parent guard asks of the same parent");
});

test("THE LIVE CASE: lupi's amend is written in her parcel's frame, and the fold keeps the step where it stood", { skip: WHY_SKIP }, async (t) => {
  const w = identityWorld(t);
  assert.deepEqual(stepAt(w, "main"), { at: STEP_WORLD, parent: "lupi/the-den-parcel" }, "canon: the step on her parcel");

  const toFileFrame = await fileFramer(w.repo);
  const plan = planStoreWriteDown([normalizeMark(entryFor(STORE_ROW))], {
    publishedPathOf: (id) => (id === "lupi/the-step" ? STEP_FILE : null), canonBytesAt: () => null, toFileFrame,
  });
  const u = plan.households[0].upserts[0];
  assert.equal(u.path, STEP_FILE, "Gate A: her filing, nothing moves");
  assert.deepEqual(u.fileRec.at, STEP_FILE_AT, "the file says the offset from her parcel, as it did before the amend");
  assert.deepEqual(plan.framed, [{ id: "lupi/the-step", path: STEP_FILE, from: { at: STEP_WORLD, points: null }, to: { at: STEP_FILE_AT } }]);

  const out = storeWriteDown({
    repo: w.repo, at: Date.parse("2026-09-23T18:00:10Z"), toFileFrame,
    input: { marks: [entryFor(STORE_ROW)], stakes: [], as_of: { window: 207, world_sha: "e01086fb", town_sha: "7115cc95" },
      selection: { by: "docket", window: 207, docket_claims: 1, carried_absent: { checked: true, count: 0 } } },
  });
  const branch = out.households[0].branch;
  assert.match(w.git("show", `${branch}:${STEP_FILE}`), /It has been crossed since\./, "the store's word reaches the file");
  const after = stepAt(w, branch);
  assert.notDeepEqual(after.at, MOVED_TO, "not where the raw carriage put it");
  assert.deepEqual(after, { at: STEP_WORLD, parent: "lupi/the-den-parcel" }, "the world's own fold: the step has not moved");
});
