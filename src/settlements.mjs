// settlements.mjs — what the keeper has actually blessed, and when.
//
// THE NUMBER COUNTS BLESSINGS, NOT BEATS (Keemin/Wright, 2026-08-08). Settlement
// runs on the 06:00/18:00Z heartbeat, but the gate can REFUSE — S22 was refused
// at this morning's heartbeat — and a refused gate does not increment. So the
// number cannot be derived from the clock: arithmetic off a cadence would have
// told the whole town "S23" tomorrow while the record still said S21, and the
// refusal case is not an edge (it happened twice this week).
//
// The truth is the world repo's own git TAGS, `settlement/S<n>`, which exist
// only when a settlement actually landed. The tag's commit date is when it was
// blessed. Nothing else in the repo carries the number:
// settlement-publications.json is a map of WHICH marks are published and holds
// neither an index nor a date.
//
// Read-only, keyless, and derived from the clone the office already keeps —
// tags ride the tick's existing fetch, so freshness costs no per-request work.

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

export const SETTLEMENT_TAG = /^settlement\/S(\d+)$/;
const RECENT_MAX = 20;

// ── the pure half: what a list of (tag, date) lines means ───────────────────
//
// Split out so the RULES have a probe that can fail without a clone: which tags
// count, how they order, and what "current" means when the numbers are sparse.

// Settlements are ordered by their NUMBER, not by their date and not by the
// order git hands them over. `git tag -l` sorts lexically, which puts S9 after
// S10 and would have made the newest settlement the wrong one the moment the
// town passed nine.
export function parseSettlementTags(rows) {
  const out = [];
  for (const row of rows ?? []) {
    const tag = String(row?.tag ?? "").trim();
    const m = SETTLEMENT_TAG.exec(tag);
    if (!m) continue;                       // a tag that is not a settlement is not one
    const n = Number(m[1]);
    if (!Number.isInteger(n) || n < 0) continue;
    const date = String(row?.date ?? "").trim() || null;
    const sha = String(row?.sha ?? "").trim() || null;
    out.push({ n, sha, date });
  }
  // newest first, and a duplicate number keeps the one that resolved a sha
  out.sort((a, b) => b.n - a.n);
  const seen = new Set();
  return out.filter((s) => (seen.has(s.n) ? false : (seen.add(s.n), true)));
}

// The current settlement is the HIGHEST number that landed — never "the latest
// heartbeat". A gap in the sequence is not an error to repair here; it is a
// refusal that happened, and the record is allowed to say so.
export function settlementsFrom(rows, { limit = RECENT_MAX } = {}) {
  const recent = parseSettlementTags(rows);
  return {
    current: recent[0] ?? null,
    recent: recent.slice(0, Math.max(0, limit)),
  };
}

// ── the newest blessing, from ONE git spawn ─────────────────────────────────
//
// `readSettlementTags` above spends two spawns per tag (71 tags = 143 spawns)
// and is right for a door asked a few times an hour. The READ tier asks "which
// settlement do I serve" on every request, so it gets a reader shaped like
// `freshestMainRef`: one `git for-each-ref` over `refs/tags/settlement/`, parsed
// here. The format is `%(refname:short) %(objectname) %(*objectname)` — the
// peeled atom LAST because it is EMPTY for a lightweight tag, and split on
// whitespace (for-each-ref does not share `log --format`'s escape dialect;
// measured 2026-09-04, a `%x1f` separator came through as four literal bytes).
export const NEWEST_SETTLEMENT_FORMAT = "%(refname:short) %(objectname) %(*objectname)";

/** Parse `for-each-ref` lines in NEWEST_SETTLEMENT_FORMAT into the newest `{ n, tag, sha }`, or null. */
export function newestSettlementFromRefLines(text) {
  const rows = [];
  for (const line of String(text ?? "").split("\n")) {
    const [tag, object, peeled] = line.trim().split(/\s+/);
    if (!tag) continue;
    // annotated: the peeled atom is the commit; lightweight: the object IS the commit
    rows.push({ tag, sha: peeled || object || null });
  }
  const newest = parseSettlementTags(rows)[0] ?? null;
  return newest && newest.sha ? { n: newest.n, tag: `settlement/S${newest.n}`, sha: newest.sha } : null;
}

// ── the chip's clock ────────────────────────────────────────────────────────
//
// The viewer's settlement chip already says "S71 · next attempt in 3h 12m"
// (`postmark-world/spectator/viewer.mjs § msToNextSettlementAttempt`,
// SETTLEMENT_HOURS_UTC = [6, 18] — the keeper's bless, POS-80's law line). The
// office cannot import the viewer, so the same two constants and the same
// arithmetic live here, and the header carries the INSTANT rather than a
// countdown: an answer is read later than it was written, and the chip already
// knows how to count down from an instant.
export const SETTLEMENT_HOURS_UTC = [6, 18];

export function nextSettlementAttemptAt(nowMs = Date.now()) {
  const now = new Date(nowMs);
  for (const hour of SETTLEMENT_HOURS_UTC) {
    const t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour);
    if (t > nowMs) return new Date(t).toISOString();
  }
  // past the last attempt of the day: the first one tomorrow
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, SETTLEMENT_HOURS_UTC[0])).toISOString();
}

// ── the reading half: the clone's own tags ──────────────────────────────────

const git = (repo, args) => execFileSync("git", ["-C", repo, ...args], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});

/**
 * IS THIS DIRECTORY A REPO, OR IS IT STANDING INSIDE SOMEONE ELSE'S?
 *
 * `git -C <dir>` ASCENDS. Handed a directory that is not a repo, git walks up
 * the tree until it finds one, and then answers about THAT repo without saying
 * it did. Measured on this box, 2026-09-05:
 *
 *     $ git -C <a fresh mkdtemp under %TEMP%> rev-parse --show-toplevel
 *     C:/Users/keemi
 *     $ git -C <the same dir> tag -l 'settlement/*'
 *     settlement/S1 … settlement/S58
 *
 * — a home directory that happens to be a git repo, forty-odd real settlement
 * tags, and a caller who asked about an empty temp folder. This is not a
 * Windows quirk and not a test-only accident: any deploy path nested under a
 * checkout gets the same wrong answer, and it is wrong in the worst direction,
 * because a settlement number the viewer trusts would be some other repo's.
 *
 * So the question is asked properly: the directory must BE the top of a work
 * tree, not merely stand somewhere inside one. Anything else is "no repo", which
 * is already an answer this function has and already returns honestly.
 *
 * `--show-toplevel` rather than `--is-inside-work-tree`: the latter is true for
 * every subdirectory, which is exactly the case being refused.
 *
 * Exported for `world2/tools/settlements-backfill.mjs`, which reads the same
 * tags from a caller-supplied checkout and must refuse the same wrong answer.
 */
export function isRepoRoot(repo) {
  let top;
  try { top = git(repo, ["rev-parse", "--show-toplevel"]).trim(); }
  catch { return false; }                     // not a repo anywhere above it
  if (!top) return false;
  const norm = (p) => resolve(p).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return norm(top) === norm(repo);
}

// ONE `git for-each-ref` for the whole list (POS-272). This used to be one
// `git tag` call and then two spawns per tag — 168 children and 567 ms per
// request on the box, the largest git door the office had (POS-263's
// inventory) — for a door the World page polls.
//
// The tag may be lightweight or annotated. The `*` atoms are the PEELED
// object, the commit an annotated tag blesses, and are empty for a lightweight
// tag, whose own object IS the commit, so each field takes the peeled value
// first. That is what `^{commit}` and `git log -1 <tag>` answered per tag: the
// sha a reader can look up in the log, and the commit's date (`%cI`'s strict
// ISO), which is when the blessing actually landed.
//
// Fields are TAB-separated (`%09` is for-each-ref's own escape; its dialect is
// `%xx`, not `log`'s `%x1f`, which is the four literal bytes measured above)
// and split on the tab alone, so an empty peeled field stays a field instead
// of shifting the ones after it.
export const SETTLEMENT_LIST_FORMAT = [
  "%(refname:short)",
  "%(*objectname:short)", "%(objectname:short)",
  "%(*committerdate:iso-strict)", "%(committerdate:iso-strict)",
].join("%09");

/** Parse `for-each-ref` lines in SETTLEMENT_LIST_FORMAT into `{ tag, sha, date }` rows. */
export function settlementRowsFromRefLines(text) {
  const rows = [];
  for (const line of String(text ?? "").split("\n")) {
    const [tag, peeledSha, sha, peeledDate, date] = line.replace(/\r$/, "").split("\t");
    if (!SETTLEMENT_TAG.test(String(tag ?? "").trim())) continue;
    rows.push({ tag: tag.trim(), sha: (peeledSha || sha || "").trim() || null, date: (peeledDate || date || "").trim() || null });
  }
  return rows;
}

export function readSettlementTags(repo) {
  if (!isRepoRoot(repo)) return [];           // not this directory's tags to give
  try {
    return settlementRowsFromRefLines(git(repo, ["for-each-ref", `--format=${SETTLEMENT_LIST_FORMAT}`, "refs/tags/settlement/"]));
  } catch {
    return [];                              // no repo, no git, no tags — all the same answer
  }
}

// The door's answer. An empty answer is HONEST, not an error: a checkout with no
// tags (a shallow clone, a fresh box) says so, and the viewer degrades to a
// countdown with no number rather than inventing one.
export function settlements(repo, options = {}) {
  return settlementsFrom(readSettlementTags(repo), options);
}
