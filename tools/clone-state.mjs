// clone-state.mjs — is one of the office's clones clean, and where does it stand
// against its upstream? ONE reader, two callers: the site sentinel (loud, every
// ten minutes, from outside the clone's own lock) and the box roll-call (the
// operator's morning board). Both judge the same collected shape, so the two
// can never disagree about what "dirty" means.
//
// ── WHY THIS EXISTS (2026-09-28) ────────────────────────────────────────────
//
// At 18:37:05Z the office tick's mint catch-up appended a signed welcome line to
// WHITE_PAGES/stamp-ledger.md in /srv/postmark-office/town-clone, then its
// `stamp-verify` refused the ledger (over an older line), and the catch-up's
// subshell ended with the appended line on disk and uncommitted. From 18:37:42Z
// every office write that runs `git pull --rebase` refused with "cannot pull
// with rebase: You have unstaged changes" — thirty in the journal — until a hand
// committed the line at 23:3xZ. Four and a half hours. A resident noticed; no
// instrument did, because nothing on the box looked at the clone's working tree.
//
// ── READ-ONLY, AND THE ONE WAY `git status` IS NOT ─────────────────────────
//
// Plain `git status` refreshes the index's stat cache and WRITES .git/index to
// save it, taking .git/index.lock for the moment it does. A watcher doing that
// every ten minutes would, now and then, hold the very lock an office write's
// `git add` needs and bounce a resident's letter with "index.lock exists" —
// the watcher causing the class it watches. `--no-optional-locks` (and
// GIT_OPTIONAL_LOCKS=0, for any git this spawns) turns the refresh off. Every
// command here is a read: status, rev-parse, rev-list, cat-file, merge-base.
// None fetches: the sentinel's reference tip comes from `git ls-remote`, which
// never touches the clone.
//
// ── WHAT COUNTS AS DIRTY ────────────────────────────────────────────────────
//
// Uncommitted changes to TRACKED files — modified, staged, deleted, renamed,
// conflicted. That is exactly what `pull --rebase` refuses on. Untracked files
// are not read at all (`--untracked-files=no`): a pull does not refuse on them,
// and the files the office legitimately keeps beside the town's tree (the
// .gitignore'd `.office-session.lock`, runtime residue) must never bark.

import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { join } from "node:path";

export const MINUTE = 60_000;

/**
 * The grace a tracked change gets before it is called dirt.
 *
 * Measured, not chosen: the longest legitimate window in which a tracked file
 * sits modified in the town clone is the tick's mint catch-up under the town
 * lock — append at 18:37:03Z, verify done at 18:37:16Z on 2026-09-28, thirteen
 * seconds — and a pen write's write-then-commit is a fraction of that. Five
 * minutes is twenty times the longest one, and a single sentinel interval is
 * still twice it. A change older than this is not a write in flight.
 */
export const DIRTY_GRACE_MS = 5 * MINUTE;

const gitEnv = () => ({ ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" });

function defaultGit(path, args) {
  return String(execFileSync("git", ["-C", path, "--no-optional-locks", ...args], {
    encoding: "utf8", env: gitEnv(), timeout: 20_000, stdio: ["ignore", "pipe", "pipe"],
  }));
}

/**
 * `git status --porcelain=v1 -z` → [{ xy, path, from? }].
 *
 * -z because a path with a space or a quote is printed quoted without it, and a
 * rename carries its source as a SECOND NUL-terminated field after the entry.
 */
export function parsePorcelainZ(out) {
  const parts = String(out ?? "").split("\0");
  const entries = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p) continue;
    const xy = p.slice(0, 2);
    const path = p.slice(3);
    const entry = { xy, path };
    if (xy[0] === "R" || xy[0] === "C") entry.from = parts[++i];
    entries.push(entry);
  }
  return entries;
}

/**
 * Read one clone. Impure (git + stat), and every failure is DATA: a clone the
 * reader could not read comes back `{ readable: false, error }`, never as clean.
 *
 * `remoteTip`, when given, is the upstream's sha as `git ls-remote` saw it; the
 * reader then says whether the clone holds it and on which side of HEAD it is.
 * Without it, `ahead`/`behind` are counted against the clone's OWN upstream ref
 * (as of its last fetch) — the only answer available with no network, which is
 * what the roll-call has.
 */
export function readCloneState(path, { remoteTip = null, git = defaultGit, stat = statSync } = {}) {
  const state = { path, readable: false };
  try {
    stat(path);
  } catch {
    return { ...state, exists: false, error: `${path} does not exist` };
  }
  state.exists = true;
  try {
    const entries = parsePorcelainZ(git(path, ["status", "--porcelain=v1", "-z", "--untracked-files=no"]));
    state.dirty = entries.map((e) => {
      let mtimeMs = null;
      try { mtimeMs = stat(join(path, e.path)).mtimeMs; } catch { /* deleted: no mtime to read */ }
      return { ...e, mtime_ms: mtimeMs };
    });
    state.head = git(path, ["rev-parse", "HEAD"]).trim();
  } catch (e) {
    return { ...state, error: firstLine(e) };
  }
  state.readable = true;

  // The upstream, as this clone last fetched it. A detached HEAD or a branch
  // with no upstream has none, and that is said rather than guessed.
  try {
    state.upstream = git(path, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).trim();
    const lr = git(path, ["rev-list", "--left-right", "--count", "HEAD...@{u}"]).trim().split(/\s+/).map(Number);
    state.local_ahead = lr[0];
    state.local_behind = lr[1];
  } catch {
    state.upstream = null;
  }

  if (remoteTip) {
    state.remote_tip = remoteTip;
    if (remoteTip === state.head) state.against_remote = "at";
    else if (!hasCommit(git, path, remoteTip)) state.against_remote = "behind";
    else if (isAncestor(git, path, remoteTip, state.head)) state.against_remote = "ahead";
    else if (isAncestor(git, path, state.head, remoteTip)) state.against_remote = "behind";
    else state.against_remote = "diverged";
  }
  return state;
}

function hasCommit(git, path, sha) {
  try { git(path, ["cat-file", "-e", `${sha}^{commit}`]); return true; } catch { return false; }
}

function isAncestor(git, path, a, b) {
  try { git(path, ["merge-base", "--is-ancestor", a, b]); return true; } catch { return false; }
}

function firstLine(e) {
  const text = String(e?.stderr || e?.message || e).trim();
  return text.split(/\r?\n/).find((l) => l.trim()) ?? "git failed";
}

/**
 * The dirt, judged. PURE — the falsifiers drive it with planted states.
 *
 * Returns { dirty: false } for a clean clone, or { dirty: true, files, since_ms,
 * in_grace } where `since_ms` is the OLDEST changed file's mtime: the file that
 * has been sitting longest is the one that says how long writes have been
 * bouncing. A deleted file has no mtime; if every changed path is a deletion the
 * age is unknown, and unknown is never excused by the grace.
 */
export function judgeDirt(state, { nowMs, graceMs = DIRTY_GRACE_MS } = {}) {
  const dirty = state?.dirty ?? [];
  if (!dirty.length) return { dirty: false };
  const mtimes = dirty.map((d) => d.mtime_ms).filter(Number.isFinite);
  const since = mtimes.length ? Math.min(...mtimes) : null;
  const age = since == null ? null : nowMs - since;
  return {
    dirty: true,
    files: dirty.map((d) => d.path),
    since_ms: since,
    age_ms: age,
    in_grace: age != null && age < graceMs,
  };
}

/** "WHITE_PAGES/stamp-ledger.md (M)" · up to three, then a count. */
export function nameFiles(state, max = 3) {
  const dirty = state?.dirty ?? [];
  const shown = dirty.slice(0, max).map((d) => `${d.path} (${d.xy.trim() || "?"})`);
  const more = dirty.length - shown.length;
  return `${shown.join(", ")}${more > 0 ? `, and ${more} more` : ""}`;
}
