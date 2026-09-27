// world-refresher.mjs — the world clone's read-only git questions, answered off
// the request path (POS-263).
//
// WHY THIS EXISTS. Every world read asks the clone the same handful of questions
// through `world-branches.mjs § git`: which main is freshest, which settlement is
// blessed, does a draft ref exist, what is world-state.json at the blessing, what
// does the walk ledger say at main. Each question was a synchronous `git` child,
// and while it ran the one Node thread served nobody. The inventory
// (docs/request-path-inventory.md) counted 197 of them in one GET /world/present
// before w39.13's ref memo and 54 after. On the Snug Harbour night the office
// answered /release in 15–60 s.
//
// WHAT IT DOES. Only one thing can change those answers: a ref moving (a fetch, a
// push, a tag, a settlement). So a refresher, started once by the server, keeps
// them in memory:
//
//   - LEARN. While a refresher runs for a clone, every read-only question the
//     readers ask it (the exact argument list) is recorded. Nothing is mirrored
//     by hand, so the set cannot drift from what the readers actually ask.
//   - ANSWER. A question whose revisions are all full shas has an answer that
//     can never change, so it is kept by its arguments alone. Any other question
//     is kept under the STAMP it was answered at: the mtime and size of every
//     file that a move of the refs it may name rewrites.
//   - REFRESH. Every tick (1 s), asynchronously, the refresher re-stats those
//     files. When the stamp moves, it asks every recorded question again with
//     `execFile`, never `execFileSync`, and publishes the new answers only once
//     all of them have come back.
//
// WHAT A READ MAY SEE, AND WHAT A WRITE MAY NOT. Before answering from memory,
// the reader re-stats those files (a few `stat`s, microseconds, no child). If
// the refs have moved since the refresher last published, the reader wakes it
// at once and still answers from what it published. So after a ref moves, a read
// can see the refs as they stood before, for as long as the refresher takes to
// catch up: tens of milliseconds on the box when git is well, and as long as git
// is stuck when it is not. That is the trade the brief asks for (POS-263: "requests
// read its in-memory answer"), and it relaxes the "a law that answers from five
// seconds ago is not the law" comment on `freshestMainRef` for READS ONLY.
// A write must see the refs it just moved, so `ensureDraftCheckout` (the one
// write in world-branches) asks git directly for everything, and a process that
// never starts a refresher (every tool, every test that does not start one)
// asks git directly, exactly as before.
//
// A BLOCKED REFRESHER BLOCKS NOBODY. Its git runs through `execFile`, so a child
// that hangs (disk stall, lock, a slow NFS) hangs only the refresher's own
// promise. The readers go on answering from the last published answers, and
// test/refresher-blocked.test.mjs holds the refresher's git for 30 s while
// /release is polled. A refresh that fails (a child that exits with a fatal
// error rather than an answer) publishes nothing, and the last answers stand.
//
// WHAT IT DOES NOT ANSWER. Anything but the read-only commands below; anything
// with options (`env`, `stdio`) the readers do not use for plain questions; any
// revision outside the namespaces the stamp watches (main, origin/main, tags,
// the draft branches), and so not HEAD, whose branch may be any; and the reflog
// (`rev-list -g`), which moves without a ref file changing. Those go to git
// exactly as they always did.

import { execFile, execFileSync } from "node:child_process";
import { stat } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";

// The files and directories a ref move under the watched namespaces rewrites.
// A loose ref is replaced by rename from `<ref>.lock` in its own directory, so a
// directory's mtime moves when any ref directly inside it does; packed refs live
// in one file.
const STAMP_PATHS = [
  "packed-refs",
  "refs/heads/main", "refs/remotes/origin/main",
  "refs/tags", "refs/tags/settlement",
  "refs/heads/draft", "refs/remotes/origin/draft",
];

// A revision is answerable from memory when it names a commit by full sha, or a
// ref the stamp watches. The draft pattern takes one path component, as
// `draftBranch` builds them; a ref nested deeper is outside the stamp.
const SHA = /^[0-9a-f]{40}$/;
const WATCHED_REF = /^(refs\/heads\/main|refs\/remotes\/origin\/main|refs\/tags\/[^/]+|refs\/tags\/settlement\/[^/]+|refs\/heads\/draft\/[^/]+|refs\/remotes\/origin\/draft\/[^/]+)$/;
const FOR_EACH_REF_PATTERN = /^refs\/(tags|tags\/settlement|heads\/draft|remotes\/origin\/draft)\/?$/;
const QUESTIONS = new Set(["rev-parse", "show", "rev-list", "merge-base", "diff", "ls-tree", "cat-file", "for-each-ref"]);

const MAX_QUESTIONS = 2000;                 // recorded ref-dependent questions per clone
const QUESTION_IDLE_MS = 30 * 60_000;       // a question nobody asked for half an hour is dropped
const IMMUTABLE_BYTES = 256 * 1024 * 1024;  // answers keyed by sha alone, oldest out first
const GIT_MAX_BUFFER = 512 * 1024 * 1024;   // world-branches' figure: world-state.json crossed 1 MiB on 2026-08-22
const CONCURRENCY = 4;

/**
 * Split one revision argument into the revisions it names:
 *   `A^{commit}`  `A:path`  `A..B`  `A...B`  `^A`  `A~2`.
 * Returns null for an argument this cannot read, which makes the question
 * unanswerable from memory (it goes to git).
 */
function revisionsOf(arg) {
  let s = arg;
  const colon = s.indexOf(":");
  if (colon !== -1) s = s.slice(0, colon);       // `<rev>:<path>` names one revision
  const parts = s.split(/\.\.\.?/);
  const out = [];
  for (let p of parts) {
    if (p.startsWith("^")) p = p.slice(1);
    p = p.replace(/\^\{commit\}$/, "").replace(/[~^]\d*$/, "");
    if (!p) return null;
    out.push(p);
  }
  return out;
}

/**
 * Classify a git argument list: null = not a question for memory; otherwise
 * `{ immutable }`, true when every revision it names is a full sha.
 */
export function questionKind(args) {
  const [cmd, ...rest] = args;
  if (!QUESTIONS.has(cmd)) return null;
  if (cmd === "rev-list" && rest.some((a) => a === "-g" || a === "--walk-reflogs" || a === "--reflog" || a === "--all")) return null;
  if (cmd === "rev-parse" && rest.some((a) => a === "--git-common-dir" || a === "--git-dir" || a === "--show-toplevel" || a === "--abbrev-ref" || a === "--symbolic-full-name")) return null;
  let immutable = true;
  let afterDashDash = false;
  for (const a of rest) {
    if (afterDashDash) continue;                  // paths, not revisions
    if (a === "--") { afterDashDash = true; continue; }
    if (a.startsWith("-")) {
      if (cmd === "for-each-ref" && a.startsWith("--format=")) continue;
      if (/^--(verify|quiet|count|is-ancestor|name-only|name-status|no-renames|format=.*)$/.test(a) || a === "-z" || a === "-r" || a === "-e" || a === "-t" || a === "-p") continue;
      return null;                                // an option we did not vet
    }
    if (cmd === "for-each-ref") {
      if (!FOR_EACH_REF_PATTERN.test(a)) return null;
      immutable = false;
      continue;
    }
    const revs = revisionsOf(a);
    if (!revs) return null;
    for (const r of revs) {
      if (SHA.test(r)) continue;
      if (!WATCHED_REF.test(r)) return null;
      immutable = false;
    }
  }
  if (cmd === "for-each-ref") immutable = false;
  return { immutable };
}

const keyOf = (args, encoding) => `${encoding}\u0000${args.join("\u0000")}`;

// ── the stamp ────────────────────────────────────────────────────────────────

function stampFrom(stats) {
  return stats.map((s) => (s ? `${s.mtimeMs}:${s.size}` : "-")).join("|");
}
function stampSync(dir) {
  return stampFrom(STAMP_PATHS.map((p) => { try { return statSync(join(dir, p)); } catch { return null; } }));
}
async function stampAsync(dir) {
  return stampFrom(await Promise.all(STAMP_PATHS.map((p) => stat(join(dir, p)).catch(() => null))));
}

// ── answers ──────────────────────────────────────────────────────────────────

// An answer is the child's stdout, or its failure. A failure is kept only when it
// is an ANSWER: exit status 1 with nothing on stderr is how `rev-parse --verify
// --quiet` says "no such ref" and `merge-base --is-ancestor` says "no". Anything
// else (a fatal, a signal, a timeout) is a broken question, and a refresh that
// meets one publishes nothing.
function answerFrom(err, stdout, stderr) {
  if (!err) return { ok: true, stdout };
  const status = typeof err.code === "number" ? err.code : err.status;
  if (status === 1 && !String(stderr ?? "").trim()) return { ok: false, status: 1, stdout, stderr: stderr ?? "" };
  return null;
}

function replay(answer, repo, args) {
  if (answer.ok) return answer.stdout;
  // The same shape execFileSync throws, so every caller's catch reads it alike.
  const e = new Error(`Command failed: git -C ${repo} ${args.join(" ")}`);
  e.status = answer.status;
  e.stdout = answer.stdout;
  e.stderr = answer.stderr;
  throw e;
}

function gitAsync(repo, args, encoding) {
  return new Promise((resolve) => {
    execFile("git", ["-C", repo, ...args], { encoding, maxBuffer: GIT_MAX_BUFFER }, (err, stdout, stderr) =>
      resolve(answerFrom(err, stdout, stderr)));
  });
}

// ── the refresher ────────────────────────────────────────────────────────────

const REFRESHERS = new Map();

function gitDirOf(repo) {
  const out = execFileSync("git", ["-C", repo, "rev-parse", "--git-common-dir"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  return isAbsolute(out) ? out : join(repo, out);
}

/**
 * Start the refresher for one world clone. Idempotent per clone. Returns the
 * handle: `refreshNow()` (a promise of the refresh it starts or joins), `stop()`,
 * and `stats()` for the operator's surface.
 */
export function startWorldRefresher(repo, { intervalMs = 1000 } = {}) {
  if (!repo) return null;
  const existing = REFRESHERS.get(repo);
  if (existing) return existing;
  let dir;
  try { dir = gitDirOf(repo); }
  catch (e) {
    if (existsSync(repo)) console.error(`[refresher] ${repo} is not a git clone (${String(e?.message ?? e).slice(0, 120)}) — world reads ask git directly`);
    return null;
  }

  const r = {
    repo, dir,
    published: null,          // { stamp, answers: Map<key, answer> } — what readers read
    questions: new Map(),     // key -> { args, encoding, lastAsked }
    immutable: new Map(),     // key -> answer (insertion order = age)
    immutableBytes: 0,
    inFlight: null,
    lastStamp: null,
    counts: { refreshes: 0, failed: 0, served: 0, servedBehind: 0, asked: 0, stampMoved: 0 },
    lastRefresh: null,
    timer: null,
  };

  r.refreshNow = () => {
    if (r.inFlight) return r.inFlight;
    r.inFlight = (async () => {
      const started = Date.now();
      try {
        const stamp = await stampAsync(dir);
        const now = Date.now();
        const pending = [...r.questions.entries()].filter(([key, q]) => {
          if (now - q.lastAsked > QUESTION_IDLE_MS) { r.questions.delete(key); return false; }
          return true;
        });
        const answers = new Map();
        let broken = 0;
        for (let i = 0; i < pending.length; i += CONCURRENCY) {
          const batch = pending.slice(i, i + CONCURRENCY);
          const got = await Promise.all(batch.map(([, q]) => gitAsync(repo, q.args, q.encoding)));
          got.forEach((a, j) => { if (a) answers.set(batch[j][0], a); else broken++; });
        }
        // The refs may have moved while the questions were out. Publishing then
        // would stamp old answers with a new stamp — so check, and go again.
        const after = await stampAsync(dir);
        if (broken || after !== stamp) {
          r.counts.failed++;
          r.lastRefresh = { at: new Date().toISOString(), ms: Date.now() - started, ok: false, broken, moved: after !== stamp };
          return false;
        }
        r.published = { stamp, answers };
        r.lastStamp = stamp;
        r.counts.refreshes++;
        r.lastRefresh = { at: new Date().toISOString(), ms: Date.now() - started, ok: true, questions: answers.size };
        return true;
      } finally {
        r.inFlight = null;
      }
    })();
    return r.inFlight;
  };

  r.tick = async () => {
    if (r.inFlight) return;
    const stamp = await stampAsync(dir).catch(() => null);
    if (stamp == null) return;
    if (!r.published || stamp !== r.published.stamp) await r.refreshNow().catch(() => {});
  };

  r.stop = () => { if (r.timer) clearInterval(r.timer); r.timer = null; REFRESHERS.delete(repo); };
  r.stats = () => ({
    repo, questions: r.questions.size, immutable_answers: r.immutable.size,
    immutable_bytes: r.immutableBytes, published_answers: r.published?.answers.size ?? 0,
    in_flight: r.inFlight != null, last_refresh: r.lastRefresh, counts: { ...r.counts },
  });

  REFRESHERS.set(repo, r);
  if (intervalMs > 0) {
    r.timer = setInterval(() => { r.tick().catch(() => {}); }, intervalMs);
    r.timer.unref?.();
  }
  r.tick().catch(() => {});
  return r;
}

export const worldRefresher = (repo) => REFRESHERS.get(repo) ?? null;

function keepImmutable(r, key, answer) {
  const size = answer.stdout?.length ?? 0;
  if (size > IMMUTABLE_BYTES / 4) return;
  r.immutable.set(key, answer);
  r.immutableBytes += size;
  while (r.immutableBytes > IMMUTABLE_BYTES && r.immutable.size) {
    const [oldKey, old] = r.immutable.entries().next().value;
    r.immutable.delete(oldKey);
    r.immutableBytes -= old.stdout?.length ?? 0;
  }
}

/**
 * The readers' side, called by `world-branches.mjs § git` for every question.
 * Returns `{ hit: true, value }` (value may be a thrown error, rethrown there)
 * when memory can answer, else `{ hit: false, remember(answer) }` so the
 * synchronous answer the caller then fetches is kept for the next asker.
 */
export function askRefresher(repo, args, encoding) {
  const r = REFRESHERS.get(repo);
  if (!r) return null;
  const kind = questionKind(args);
  if (!kind) return null;
  const key = keyOf(args, encoding);
  r.counts.asked++;

  if (kind.immutable) {
    const a = r.immutable.get(key);
    if (a) { r.counts.served++; return { hit: true, answer: a }; }
    return { hit: false, remember: (answer) => { if (answer) keepImmutable(r, key, answer); } };
  }

  let q = r.questions.get(key);
  if (!q) {
    if (r.questions.size >= MAX_QUESTIONS) return null;
    q = { args: [...args], encoding, lastAsked: 0 };
    r.questions.set(key, q);
  }
  q.lastAsked = Date.now();

  const pub = r.published;
  if (!pub) return { hit: false, remember: () => {} };
  const now = stampSync(r.dir);
  const moved = now !== pub.stamp;
  if (moved) {
    // The refs moved and the refresher has not published since. Wake it now
    // rather than at its next tick, and go on answering from what it last
    // published (see the header: a read is never kept waiting on git).
    if (now !== r.lastStamp) { r.lastStamp = now; r.counts.stampMoved++; }
    if (!r.inFlight) queueMicrotask(() => { r.tick().catch(() => {}); });
  }
  const a = pub.answers.get(key);
  if (a) { r.counts.served++; if (moved) r.counts.servedBehind++; return { hit: true, answer: a }; }
  // A question the refresher has not asked yet: git answers it this once, and the
  // answer is kept only if it belongs to the stamp the published answers hold.
  return { hit: false, remember: (answer) => { if (answer && !moved && r.published === pub) pub.answers.set(key, answer); } };
}

export { answerFrom, replay };
