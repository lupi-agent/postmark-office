// world-filing-order.test.mjs — THE FOLD'S MARK ORDER, DERIVED FROM THE FILINGS
// (POS-410; src/world-filing-order.mjs).
//
//   node --test test/world-filing-order.test.mjs
//
// The fold is first-in-order-wins, and its order is the loader's depth-first walk
// over WORLD/marks. Wright's word (2026-10-05): derived, never stored. The filing
// is the freeze manifest's, else the write-down's placement rule (Gate A: the
// tree at the sha; then by identity, or under the parent). The last test is the
// one that matters: on a real settlement tag, the store-shaped records sorted by
// this derivation are in exactly the order the world's own loader reads them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { walkOrder, filingDirs, inFilingOrder, filingAt } from "../src/world-filing-order.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("the walk: a directory before what it holds, names compared as the loader's filesystem lists them", () => {
  const dirs = [
    "WORLD/marks/lux/the-second-light",
    "WORLD/marks/let-there-be-light/aelyria/the-archway",
    "WORLD/marks/let-there-be-light/aelyria",
    "WORLD/marks/let-there-be-light/Zed",
    "WORLD/marks/let-there-be-light/the-town-centre",
    "WORLD/marks/let-there-be-light",
  ];
  assert.deepEqual([...dirs].sort(walkOrder), [
    "WORLD/marks/let-there-be-light",
    "WORLD/marks/let-there-be-light/aelyria",
    "WORLD/marks/let-there-be-light/aelyria/the-archway",
    "WORLD/marks/let-there-be-light/the-town-centre",
    "WORLD/marks/let-there-be-light/Zed",
    "WORLD/marks/lux/the-second-light",
  ], "a capital is listed with its letter, not before every lower-case name");
});

test("a filing is the freeze's, else the tree's, else the write-down's rule", () => {
  const records = [
    { id: "a/frozen-one", by: "a", slug: "frozen-one", kind: "sited" },
    { id: "b/filed-later", by: "b", slug: "filed-later", kind: "parcel" },
    { id: "c/new-house", by: "c", slug: "new-house", kind: "sited" },
    { id: "c/its-name", by: "c", slug: "its-name", kind: "naming", parent: "c/new-house" },
    { id: "d/a-note", by: "d", slug: "a-note", kind: "predicated", parent: "terrain:the-sea" },
  ];
  const filing = {
    frozen: new Map([["a/frozen-one", "WORLD/marks/let-there-be-light/old-quarter/frozen-one"]]),
    filed: new Map([
      ["a/frozen-one", "WORLD/marks/somewhere-else/frozen-one"],
      ["b/filed-later", "WORLD/marks/let-there-be-light/the-high-ground/filed-later"],
    ]),
  };
  const dirs = filingDirs(records, filing);
  assert.equal(dirs.get("a/frozen-one"), "WORLD/marks/let-there-be-light/old-quarter/frozen-one", "the freeze outranks the tree");
  assert.equal(dirs.get("b/filed-later"), "WORLD/marks/let-there-be-light/the-high-ground/filed-later", "Gate A: an existing filing never moves");
  assert.equal(dirs.get("c/new-house"), "WORLD/marks/c/new-house", "Gate B: a new sited mark files at its id");
  assert.equal(dirs.get("c/its-name"), "WORLD/marks/c/new-house/its-name", "a naming mark files under its parent");
  assert.equal(dirs.get("d/a-note"), "WORLD/marks/let-there-be-light/a-note", "a terrain parent is no directory: the root prefix");
  assert.deepEqual(inFilingOrder(records, filing).map((r) => r.id),
    ["c/new-house", "c/its-name", "d/a-note", "a/frozen-one", "b/filed-later"],
    "WORLD/marks/c before WORLD/marks/let-there-be-light; there, the file a-note, then old-quarter, then the-high-ground");
});

// ── ON A REAL TAG ────────────────────────────────────────────────────────────
const WORLD_CLONE = process.env.WORLD_CLONE ?? join(ROOT, "world-clone");
const hasTag = (() => { try { execFileSync("git", ["-C", WORLD_CLONE, "rev-parse", "-q", "--verify", "settlement/S93^{commit}"], { stdio: "ignore" }); return true; } catch { return false; } })();
const NO_TAG = existsSync(WORLD_CLONE) && hasTag ? false : `needs the world clone with settlement/S93 (${WORLD_CLONE})`;

test("S93: the store-shaped records, in the derived order, are exactly the loader's order", { skip: NO_TAG, timeout: 300000 }, async () => {
  const scratch = mkdtempSync(join(tmpdir(), "filing-order-"));
  const W = join(scratch, "w");
  try {
    execFileSync("git", ["-c", "core.autocrlf=false", "-c", "core.longpaths=true", "clone", "-q", "--shared", "--no-checkout",
      "-c", "core.autocrlf=false", "-c", "core.longpaths=true", WORLD_CLONE, W], { stdio: "ignore" });
    execFileSync("git", ["-C", W, "-c", "advice.detachedHead=false", "checkout", "-q", "settlement/S93"], { stdio: "ignore" });
    const { deriveSeed } = await import("../world2/tools/seed-import.mjs");
    const { deriveLaw } = await import("../world2/tools/law-ingest.mjs");
    const { marksFromRows } = await import("../src/world2-fold.mjs");
    const { markRowsOfVersions } = await import("../src/world-snapshot.mjs");
    const seed = await deriveSeed({ worldRepo: W, lawSha: "0".repeat(40) });
    const slugById = new Map(seed.marks.map((m) => [m.id, m.slug]));
    const inputs = seed.marks.map((m) => ({ ...m, parent: m.parent ? slugById.get(m.parent) : null }));   // the seal's row: parent by slug
    const jsonb = (v) => JSON.parse(JSON.stringify(v));
    const records = marksFromRows(
      markRowsOfVersions(inputs.map((m) => ({ row: JSON.stringify(jsonb({ slug: m.slug, kind: m.kind, owner: m.owner, body: m.body, geometry: m.geometry, parent: m.parent, data: m.data })) }))),
      (await deriveLaw({ lawRepo: W })).rows.filter((r) => r.kind === "class").map(jsonb));
    const mf = await import(pathToFileURL(join(W, "tools", "marks-fold.mjs")).href);
    const loaderIds = mf.loadMarks(join(W, "WORLD", "marks")).map((r) => r.id);
    const filing = filingAt(W, "HEAD");
    assert.equal(filing.frozen.size, 960);
    const derived = inFilingOrder(records, filing).map((r) => r.id);
    assert.equal(derived.length, loaderIds.length);
    const at = derived.findIndex((id, i) => id !== loaderIds[i]);
    assert.equal(at, -1, `the derived order leaves the loader's at ${at}: ${derived[at]} vs ${loaderIds[at]}`);
    // and the freeze alone is not enough: 48 marks were filed after it in places no rule reproduces
    const freezeOnly = inFilingOrder(records, { frozen: filing.frozen, filed: new Map() }).map((r) => r.id);
    assert.notDeepEqual(freezeOnly, loaderIds);
  } finally {
    rmSync(W, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
});
