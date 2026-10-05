// world-filing-order.mjs — THE ORDER THE FOLD READS THE MARKS IN, DERIVED
// (POS-410; Wright's word on its first shape, 2026-10-05).
//
// The world's fold is first-in-order-wins (parcel overlap, the carve), so the
// order of its `marks` array is an input, not a presentation. The loader
// (`marks-fold.mjs § loadMarks`) reads it as a depth-first walk of WORLD/marks:
// each directory's own mark before the directories under it, siblings in the
// filesystem's order. No store row records a mark's directory, and the ruling is
// that none will: the order is DERIVED, never stored as an ordinal.
//
// ── A MARK'S FILING, IN ORDER OF AUTHORITY ───────────────────────────────────
//
//   1. WORLD/filing-freeze.json at the snapshot's law sha: "A mark's directory is
//      its historical filing … it never moves again" (the founder's 2026-08-25
//      freeze). 960 marks.
//   2. Otherwise the write-down's placement rule (src/store-writedown.mjs § the
//      plan, src/world-journal.mjs § pathFor), whose GATE A is "an existing filing
//      never moves": where the world's tree at that same sha already files the
//      mark (the write-down asks canon's tree the same way: a leaf directory whose
//      mark.md says `by:` the mark's author). Measured on S93: 48 of the 1,346
//      records were filed after the freeze in a region directory that no rule
//      reproduces, so without Gate A the order is wrong for them.
//   3. Otherwise GATE B and the nesting rule: a sited mark or a parcel files at
//      WORLD/marks/<by>/<slug>/, anything else under its parent's directory, or at
//      the root prefix when it has none. This is where a mark cleared after the
//      law sha will be filed.
//
// Then the walk: directories compared one name at a time in the order the
// loader's filesystem lists them (case folded to upper, then by code unit, as
// NTFS lists them; measured on S93: sorting by the loader's own directories this
// way gives the loader's order exactly), a directory before what it holds.
//
// The git reads (1 and 2) are reads at a sha, which git holds immutably; the
// snapshot names the sha. `inFilingOrder` is pure; `filingAt` does the reads.

import { execFileSync, spawnSync } from "node:child_process";
import { pathFor } from "./world-journal.mjs";

const git = (repo, args, input) => {
  const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", input, maxBuffer: 256 << 20 });
  if (r.status !== 0) throw new Error(`git ${args[0]} at ${repo}: ${String(r.stderr).trim().slice(0, 200)}`);
  return r.stdout;
};
const dirOfPath = (p) => String(p).replace(/\/mark\.md$/, "");

/**
 * The filings a world commit knows: `{ frozen, filed }`, two Maps of mark id →
 * directory. `frozen` is WORLD/filing-freeze.json's (empty when the commit
 * predates the freeze); `filed` is the commit's tree, each WORLD/marks/**\/mark.md
 * keyed by `<by>/<its directory's name>`, its `by:` read from the file (the
 * write-down's Gate A, read in two git calls instead of one per mark). Where a
 * tree files one id twice, the first in the tree's order stands, as the loader's
 * walk would meet it.
 */
export function filingAt(worldRepo, sha) {
  let frozen = new Map();
  try {
    const doc = JSON.parse(git(worldRepo, ["show", `${sha}:WORLD/filing-freeze.json`]));
    frozen = new Map(Object.entries(doc.marks ?? {}).map(([id, dir]) => [id, dirOfPath(dir)]));
  } catch { frozen = new Map(); }
  const entries = git(worldRepo, ["ls-tree", "-r", sha, "--", "WORLD/marks"]).split("\n")
    .map((l) => /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(l)).filter((m) => m && m[2].endsWith("/mark.md"))
    .map((m) => ({ oid: m[1], path: m[2] }));
  const filed = new Map();
  if (entries.length) {
    // One cat-file over every blob: "<oid> blob <size>\n<bytes>\n", in input order.
    const out = Buffer.from(execFileSync("git", ["-C", worldRepo, "cat-file", "--batch"],
      { input: entries.map((e) => e.oid).join("\n") + "\n", maxBuffer: 512 << 20 }));
    let at = 0;
    for (const e of entries) {
      const nl = out.indexOf(10, at);
      const size = Number(out.subarray(at, nl).toString("utf8").split(" ")[2]);
      const text = out.subarray(nl + 1, nl + 1 + size).toString("utf8");
      at = nl + 1 + size + 1;
      const by = /^by:\s*(.+)$/m.exec(text)?.[1]?.trim();
      const dir = dirOfPath(e.path);
      const id = by ? `${by}/${dir.split("/").pop()}` : null;
      if (id && !filed.has(id)) filed.set(id, dir);
    }
  }
  return { frozen, filed };
}

/** One directory name against another, the way the loader's filesystem lists them. PURE. */
const byListing = (a, b) => {
  const A = a.toUpperCase(), B = b.toUpperCase();
  return A < B ? -1 : A > B ? 1 : (a < b ? -1 : a > b ? 1 : 0);
};

/** Two directories in the depth-first walk's order: name by name, a directory before what it holds. PURE. */
export function walkOrder(a, b) {
  const x = a.split("/"), y = b.split("/");
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const c = byListing(x[i], y[i]);
    if (c) return c;
  }
  return x.length - y.length;
}

/**
 * Each record's filing directory: `Map(id → dir)`. PURE. `records` are the
 * fold's input records (marksFromRows'), class marks included; `filing` is
 * `filingAt`'s answer, or null for none (every mark then files by the rule).
 */
export function filingDirs(records, filing = null) {
  const byId = new Map(records.map((r) => [r.id, r]));
  const dirs = new Map();
  const dirOf = (id, seen) => {
    if (dirs.has(id)) return dirs.get(id);
    const known = filing?.frozen?.get(id) ?? filing?.filed?.get(id);
    if (known) { dirs.set(id, known); return known; }
    const r = byId.get(id);
    if (!r) return null;
    const parent = typeof r.parent === "string" && !r.parent.startsWith("terrain:") ? r.parent : null;
    const path = pathFor({ kind: r.kind, id: r.id, by: r.by, slug: r.slug, parent_id: parent }, {
      parentPathOf: (pid) => (seen.has(pid) ? null : dirOf(pid, new Set([...seen, id]))),
    });
    const dir = path ? dirOfPath(path) : null;
    dirs.set(id, dir);
    return dir;
  };
  for (const r of records) dirOf(r.id, new Set([r.id]));
  return dirs;
}

/**
 * The records in the order the loader would read them from their filings: the
 * ONE derivation of the fold's mark order (the snapshot's fold and --verify both
 * take it from here). PURE. A record with no filing at all sorts last, by id.
 */
export function inFilingOrder(records, filing = null) {
  const dirs = filingDirs(records, filing);
  return [...records].sort((a, b) => {
    const x = dirs.get(a.id), y = dirs.get(b.id);
    if (x == null || y == null) return (x == null) - (y == null) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    return walkOrder(x, y) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
}
