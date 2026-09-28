// hearing-window.mjs — where the ear's window opens (POS-226).
//
// Between settlements every say stays hearable; at a settlement the hearable
// set starts fresh (Keemin, 2026-09-25). The instant it starts is the newest
// settlement the BOX PUBLISHED (Wright's ruling, 2026-09-28): the crossing's
// `settlement: sweep …` commit on world main, which `deploy/settlement-auto.sh`
// pushes at the 06:00/18:00Z heartbeat. Not the keeper's tag, which blesses
// that commit later and can lag it by hours (S86: published 06:00:51Z on
// 2026-09-28, still unblessed at noon); not the scheduled hour, because a
// refused crossing publishes nothing and resets nothing; and not the ferry's
// 00:00/12:00Z. The store's `settlements` table cannot answer this — a row there
// exists only once the tag does (world2/schema/018_settlements.sql).
//
// OFF THE SAY PATH. The say asks `hearingWindow()`, which answers from memory
// and never waits on git. The answer is re-asked in the background with an
// async `git log` at most once a minute (the tick's world fetch is what moves
// it, every 15 minutes), and a reader that trips leaves the last answer
// standing. When world main cannot answer, the newest `settlement/S<n>` tag's
// commit date stands in, and `disclosure` says so.

import { execFile } from "node:child_process";

export const SWEEP_SUBJECT = "^settlement: sweep";
export const HEARING_REFRESH_MS = 60_000;

// Both mains, whichever the clone has: `--glob` implies a trailing `/*` unless
// the pattern holds a wildcard, so the bracket is what makes it match the ref
// itself — and a glob that matches nothing is not an error, as a missing ref is.
const MAIN_REFS = ["--glob=refs/heads/mai[n]", "--glob=refs/remotes/origin/mai[n]"];

const run = (repo, args) => new Promise((resolve, reject) => {
  execFile("git", ["-C", repo, ...args], { encoding: "utf8", timeout: 10_000, windowsHide: true },
    (err, out) => (err ? reject(err) : resolve(String(out).trim())));
});

/** The instant (ms) world main's newest sweep commit was published, or null. */
export async function publishedSettlementAt(repo) {
  const iso = await run(repo, ["log", "-1", "--format=%cI", `--grep=${SWEEP_SUBJECT}`, ...MAIN_REFS]);
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** The newest settlement tag's commit date (ms), or null — the fallback. */
export async function blessedSettlementAt(repo) {
  const out = await run(repo, ["for-each-ref", "--sort=-*committerdate", "--count=1",
    "--format=%(*committerdate:iso-strict)%(committerdate:iso-strict)", "refs/tags/settlement/"]);
  const ms = Date.parse(out);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * One window reader per clone. `read()` answers from memory at once; it wakes a
 * background refresh when the answer is older than `refreshMs`. `refresh()` is
 * awaitable, for the boot and for tests.
 */
export function createHearingWindow({ repo, refreshMs = HEARING_REFRESH_MS, clock = () => Date.now(),
  published = publishedSettlementAt, blessed = blessedSettlementAt } = {}) {
  let known = null;       // { since, source, disclosure }
  let askedAt = -Infinity;
  let inFlight = null;

  async function refresh() {
    if (inFlight) return inFlight;
    askedAt = clock();
    inFlight = (async () => {
      try {
        const at = await published(repo);
        if (at != null) { known = { since: at, source: "world main's newest settlement commit", disclosure: null }; return known; }
      } catch { /* fall through to the tag */ }
      try {
        const at = await blessed(repo);
        if (at != null) {
          known = { since: at, source: "the newest settlement tag",
            disclosure: "world main's newest settlement could not be read, so the ear's window opens at the newest BLESSED settlement, which can be one or more crossings older" };
          return known;
        }
      } catch { /* the last answer stands */ }
      return known;
    })().finally(() => { inFlight = null; });
    return inFlight;
  }

  function read() {
    if (clock() - askedAt >= refreshMs) refresh().catch(() => {});
    return known;
  }

  return { read, refresh };
}
