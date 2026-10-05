#!/usr/bin/env node
// notes-import.mjs — a one-time import of each resident's newest git-era note into
// the store (POS-392 follow-up; migration 063).
//
//   node world2/tools/notes-import.mjs (--dry-run | --apply) --world-repo <office world clone> [--json]
//
//   env: WORLD2_PG=1 and WORLD2_PG_URL (the office's own `office_api` connection,
//        the pen 063 grants INSERT to), or --pg-url <url>.
//
//   EXIT: 0 · 3 at least one resident REFUSED (named on its line; the rest are
//         written under --apply) · 2 cannot run (no clone, no store).
//
// ── WHAT IT READS ───────────────────────────────────────────────────────────
//
// Before 063 the note door kept `NOTES/<handle>.md` on the household's
// sketchbook branch, `draft/<household>`. This reads every such file on the
// tips of the clone's `refs/remotes/origin/draft/*` — `git show
// origin/draft/<x>:NOTES/<h>.md`, nothing older — and keeps, per resident, the
// NEWEST by that file's own commit time. A resident whose note stands on two
// branches (a house that moved) gets the newer; the line names the other.
//
// ── WHAT IT WRITES, AND WHAT IT NEVER TOUCHES ───────────────────────────────
//
// Through `src/note-store.mjs § writeNote` and nothing else, so the household
// spelling and the row policy are exactly the door's. `ifAbsent`: a resident who
// already has a note in the store (written through the door since the deploy,
// or by an earlier run of this tool) is skipped, and a door write racing this
// one wins (ON CONFLICT DO NOTHING). Idempotent: a second --apply writes nothing.
// The imported row is dated at the git note's own commit time.
//
// It writes no file, commit or ref, and pushes nothing. Deleting the branches
// afterwards is the operator's act, not this tool's.
//
// ── WHAT IT PRINTS ──────────────────────────────────────────────────────────
//
// Handle, household, bytes, source branch, verdict. NEVER the note's text.
//
// ── REFUSALS, BY NAME ───────────────────────────────────────────────────────
//
// A handle the registry houses no one under (the resolver's `solo:` answer), a
// file name that is not a handle, an empty note, or one over the door's 2000
// characters. Each is named on its own line and nothing is written for it.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Every note on an origin/draft tip: { branch, handle, file, body, at }. */
function notesOnTips(git) {
  const refs = git("for-each-ref", "--format=%(refname)", "refs/remotes/origin/draft/").split("\n").filter(Boolean);
  const out = [];
  for (const ref of refs) {
    const branch = ref.slice("refs/remotes/origin/".length);
    let names = [];
    try { names = git("ls-tree", "--name-only", `${ref}:NOTES`).split("\n").filter((n) => n.endsWith(".md")); } catch { continue; }
    for (const file of names) {
      const path = `NOTES/${file}`;
      out.push({ branch, handle: file.slice(0, -3), file: path,
        body: git("show", `${ref}:${path}`).trim(), at: git("log", "-1", "--format=%cI", ref, "--", path).trim() });
    }
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const has = (name) => args.includes(name);
  const USAGE = "usage: notes-import.mjs (--dry-run | --apply) --world-repo <office world clone> [--pg-url <url>] [--json]";
  const die = (code, words) => { console.error(words); process.exit(code); };

  const DRY = has("--dry-run"), APPLY = has("--apply");
  if (DRY === APPLY) die(2, `${USAGE}\npass exactly one of --dry-run or --apply`);
  const REPO = opt("--world-repo");
  if (!REPO) die(2, `${USAGE}\n--world-repo <office world clone> is required`);
  if (!existsSync(join(REPO, ".git")) && !existsSync(join(REPO, "HEAD"))) die(2, `not a git clone: ${REPO}`);
  if (opt("--pg-url")) Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: opt("--pg-url") });
  if (process.env.WORLD2_PG !== "1" || !process.env.WORLD2_PG_URL)
    die(2, "no store: set WORLD2_PG=1 and WORLD2_PG_URL (the office's office_api connection), or pass --pg-url");

  const HANDLE = /^[a-z0-9][a-z0-9-]*$/;
  const MAX = 2000;
  const git = (...a) => execFileSync("git", ["-C", REPO, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 });

  const { noteHouseholdOf, noteOf, writeNote } = await import(pathToFileURL(resolve(HERE, "..", "..", "src", "note-store.mjs")).href);

  let notes;
  try { notes = notesOnTips(git); } catch (e) { die(2, `cannot read the clone's draft branches: ${String(e?.message ?? e).slice(0, 200)}`); }

  // newest per resident, by the note file's own commit time (ties: branch name order)
  const byHandle = new Map();
  for (const n of notes) (byHandle.get(n.handle) ?? byHandle.set(n.handle, []).get(n.handle)).push(n);
  const lines = [];
  let refused = 0, wrote = 0, skipped = 0;
  for (const [handle, all] of [...byHandle].sort(([a], [b]) => a.localeCompare(b))) {
    all.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.branch.localeCompare(b.branch));
    const n = all[0];
    const line = { handle, household: null, bytes: Buffer.byteLength(n.body, "utf8"), branch: n.branch, note_commit: n.at,
      ...(all.length > 1 ? { also_on: all.slice(1).map((x) => x.branch) } : {}) };
    const refuse = (why) => { refused++; lines.push({ ...line, verdict: `REFUSED: ${why}` }); };
    if (!HANDLE.test(handle)) { refuse(`"${n.file}" is not a resident handle`); continue; }
    if (!n.body) { refuse("the note is empty"); continue; }
    if ([...n.body].length > MAX) { refuse(`the note is ${[...n.body].length} characters; the door's cap is ${MAX}`); continue; }
    let household;
    try { household = await noteHouseholdOf(handle); } catch (e) { die(2, `the store did not answer: ${String(e?.message ?? e).slice(0, 200)}`); }
    if (!household) { refuse("the registry houses no resident by this handle, so the note's household cannot be resolved"); continue; }
    line.household = household;
    const standing = await noteOf(handle);
    if (standing) { skipped++; lines.push({ ...line, verdict: `skip: already has a note in the store (written ${standing.written_at})` }); continue; }
    if (DRY) { wrote++; lines.push({ ...line, verdict: "would write" }); continue; }
    const w = await writeNote(handle, n.body, { now: Date.parse(n.at), ifAbsent: true });
    if (w.kept) { wrote++; lines.push({ ...line, household: w.household, verdict: `written (dated ${w.written_at})` }); }
    else { skipped++; lines.push({ ...line, verdict: "skip: a note arrived through the door meanwhile; it stands" }); }
  }

  const branches = new Set(notes.map((n) => n.branch)).size;
  const summary = { mode: DRY ? "dry-run" : "apply", branches_with_notes: branches, notes_on_tips: notes.length,
    residents: byHandle.size, [DRY ? "would_write" : "written"]: wrote, skipped, refused };
  if (has("--json")) console.log(JSON.stringify({ ...summary, lines }, null, 2));
  else {
    console.log(`# ${summary.mode}: ${branches} branches carry ${notes.length} notes for ${byHandle.size} residents · ${DRY ? "would write" : "written"} ${wrote} · skipped ${skipped} · refused ${refused}`);
    for (const l of lines)
      console.log([l.handle, l.household ?? "-", `${l.bytes} B`, l.branch, l.verdict].join("\t") + (l.also_on ? `\t(also on ${l.also_on.join(", ")})` : ""));
  }
  process.exit(refused ? 3 : 0);
}

const isMain = process.argv[1]
  && (await import("node:fs")).realpathSync(process.argv[1]).replace(/\\/g, "/").endsWith("/notes-import.mjs");
if (isMain) await main();
