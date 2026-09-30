// world-drain.mjs — THE DRAIN. The journal empties into the record, once, as one act.
//
// ── WHAT THIS IS ─────────────────────────────────────────────────────────────
//
// POS-5 slice 2 of the world-runtime ladder (§3). Slice 1 made every world
// mutation one INSERT into an append-only journal in dynamic.db. This is the
// other end: at each settlement the journal empties upward into the world repo
// and then TRUNCATES, so the live layer only ever holds what has happened since
// the last save.
//
// §3, verbatim: "At each settlement: ratified marks → main (canon); still-
// unpublished drafts → written down to `draft/<household>` sketchbook branches
// (their ontological home: static-by-nature, not-yet-happened — a git branch
// that isn't main IS proto-canon); event lines → `STATE/log/<N>.jsonl`; then the
// journal TRUNCATES, sequence advances."
//
// The first clause — ratified marks to main — is the KEEPER'S chain and this
// module does not touch it. The settlement sweep goes on consuming the
// sketchbook branches exactly as it does today; what changes is who writes them.
//
// ── THE LAW THIS FILE ANSWERS ────────────────────────────────────────────────
//
// `the-atomic-drain` (world main, `logos/the-save/the-atomic-drain`, tier
// constitution, planted 2026-08-22):
//
//   "The drain's write-down and the journal's truncate are one act — a crash
//    between them eats no draft, and a lost save recomputes from the log."
//
// A working tree, a set of git refs and a SQLite file cannot join one
// transaction, so "one act" cannot be bought with a database primitive. It is
// bought with an ORDER and an INVARIANT:
//
//   THE TRUNCATE IS LAST, AND IT IS THE ONLY IRREVERSIBLE STEP.
//   Everything before it is idempotent and re-runnable.
//   Therefore the journal is always a SUPERSET of what has been written down,
//   never a subset — and a crash anywhere eats no draft, because the row that
//   was not yet written down is still in the journal to be written down again.
//
// The truncate itself IS atomic, because the delete and the cursor advance are
// one SQLite transaction. There is no state where the rows are gone and the
// cursor has not moved, or the reverse.
//
// Crash by crash, which is what `test/world-drain.test.mjs` injects:
//
//   before the write-down     nothing happened; a re-run drains everything.
//   mid write-down            some sketchbook refs moved, others did not. The
//                             cursor has not moved, so a re-run replays ALL
//                             rows; the households already written get the same
//                             tree, which produces no second commit at all.
//   after write-down          the record holds it, the journal still holds it.
//   before the truncate       A re-run is a no-op write-down plus the truncate.
//   during the truncate       SQLite's transaction decides: both, or neither.
//   after the truncate        the cursor says so; a re-run drains nothing.
//
// "A lost save recomputes from the log" is the second clause, and it is why
// every run is pinned to an INSTANT (`at`). Commit dates come from that instant,
// never from the wall clock, so replaying an interrupted drain at the same
// instant lands the same tree under the same commit sha. Byte-identical
// convergence is a claim about shas here, not a hopeful phrase.
//
// ── NO CHECKOUT, EVER ────────────────────────────────────────────────────────
//
// The write-down is pure git plumbing against a private index: hash-object,
// read-tree, update-index, write-tree, commit-tree, update-ref. The clone's
// working tree is never touched and never consulted, which matters for three
// reasons. The tree belongs to whatever else is using it (the settlement, a
// crossing-save, a flag-off write pen). A checkout is exactly the machinery §2
// retires. And `update-ref` with an expected old value is a compare-and-swap, so
// a branch someone else moved underneath us is refused rather than clobbered.
//
// ── TWO DESTINATIONS, BECAUSE THERE ARE TWO KINDS OF THING ───────────────────
//
// §0: "the dynamic DB is the runtime journal; STATE/ is its crystallized
// history; the sketchbook is proto-canon; main is canon."
//
// So EVERY row goes to STATE — including mark rows. The sketchbook holds a
// mark's FINAL state, which is all canon needs; the amend chain, the withdrawal,
// and every line's pinned witnesses are HISTORY, and if the drain dropped them
// the constitutional record `the-witnessed-line` establishes would evaporate
// every twelve hours. Mark rows go to the sketchbook IN ADDITION, not instead.
//
// ── WHY A SEPARATE LOG FILE FROM crossing-save's ─────────────────────────────
//
// `tools/crossing-save.mjs` also writes `STATE/log/<N>.*`, and it is DERIVATIVE:
// it rebuilds each window from the store every run and its whole determinism
// story is "same store, same instant, same bytes". The journal's rows are
// CONSUMED — after the truncate they exist nowhere else — so crossing-save could
// never re-derive them, and the first time it rewrote a window it would erase
// them.
//
// Two writers with two recovery stories are not one file. The drain writes
// `STATE/log/<N>.journal.jsonl` (+ `.journal.meta.json`) in the same line
// grammar, and unifying the two into one window file is named work, not
// something to sneak in under a slice that must not lose records. See the
// handback's remainder.
//
// Env: WORLD_SINGLE_LOG=1 (the drain refuses without it — the flag family is
// one switch), WORLD_CLONE, WORLD_DYNAMIC_DB, BOT_NAME/BOT_EMAIL.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { fileURLToPath } from "node:url";
import { getMeta, openDynamic, putMeta, singleLogEnabled } from "./dynamic-store.mjs";
import { markRecord } from "./mark-record.mjs";
import { WORLD_CLONE } from "./world-store.mjs";
import { draftBranch, mainRef, materializeAtRef, readAtRef, refExists } from "./world-branches.mjs";
import {
  ACTION_WITHDRAW, CLASS_MARK, frozenFilingAt, journalHead, pathFor, readJournal,
} from "./world-journal.mjs";
// Every name the enter/exit record has ever answered to. One home for that list
// (`src/enter-exit-ledger.mjs`), read here so this filter cannot drift from it.
import { LEDGER_NAMES } from "./enter-exit-ledger.mjs";
// The declared-parent law (postmark#3020) — the ancestor walk, minted once so
// the guard and this framer cannot disagree about what an ancestor IS.
import { declaredParentIdOf, idOfMarkFileFrom } from "./mark-declared-parent.mjs";

/** The cursor slice 1 reserved on the health surface and left unwritten. This is what writes it. */
export const DRAIN_CURSOR = "journal_drained_through";

// The proven archiver lives beside this module's own directory, in tools/.
const HERE_TOOLS = join(dirname(fileURLToPath(import.meta.url)), "..", "tools");

const ROOT_PREFIX = "WORLD/marks/let-there-be-light";

const git = (repo, args, opts = {}) => execFileSync("git", ["-C", repo, ...args], {
  encoding: opts.encoding ?? "utf8",
  maxBuffer: 64 * 1024 * 1024,
  stdio: ["pipe", "pipe", "pipe"],
  ...opts,
});

/** The failpoint hook. Named rather than boolean so a falsifier can crash at one seam and leave the rest alone. */
const trip = (failAt, name) => {
  if (failAt === name) {
    const e = new Error(`drain failpoint: ${name}`);
    e.failpoint = name;
    throw e;
  }
};

// ── the plan (pure) ──────────────────────────────────────────────────────────

/**
 * WHAT THIS DRAIN WOULD DO, as data. No git, no store, no clock.
 *
 * Pure so the whole sorting decision — which row lands in which sketchbook, at
 * which path, in which crossing's log — is falsifiable without building a repo.
 * The impure half below only carries it out.
 *
 * `toFileFrame` is the SCHEMA v3 conversion, injected: the journal speaks WORLD
 * coordinates as the resident spoke them at the door, and the file speaks its
 * parent's frame. Slice 1 deliberately did not convert at the write ("doing it
 * twice is how the two eras would disagree about where a mark is"), so this is
 * the one place it happens. Identity by default, because a caller that cannot
 * read the fold must not silently shift geometry.
 */
export function planDrain(rows, { publishedPathOf = null, toFileFrame = null } = {}) {
  const head = rows.reduce((n, r) => Math.max(n, r.seq), 0);

  // supersession-by-latest, exactly as the read side folds it — one mark, one
  // final state, whatever chain of declarations produced it.
  const latest = new Map();
  const declared = new Map();
  const householdOf = new Map();
  for (const row of rows) {
    if (row.class !== CLASS_MARK || !row.object) continue;
    if (row.action !== ACTION_WITHDRAW) declared.set(row.object, row);
    latest.set(row.object, row);
    if (row.household) householdOf.set(row.object, row.household);
  }

  const pathOf = (id) => {
    const d = declared.get(id);
    if (!d) return typeof publishedPathOf === "function" ? publishedPathOf(id) : null;
    return pathFor({ ...(d.payload ?? {}), id }, {
      // GATE A before GATE B (the freeze, 2026-08-25): "it never moves again".
      // A mark main already holds keeps its filing; only a mark with no filing
      // yet lands at its id.
      publishedPathOf,
      parentPathOf: (pid) => {
        const p = declared.get(pid);
        const pp = p ? pathFor({ ...(p.payload ?? {}), id: pid })
          : (typeof publishedPathOf === "function" ? publishedPathOf(pid) : null);
        return pp ? pp.replace(/\/mark\.md$/, "") : null;
      },
    });
  };

  const byHousehold = new Map();
  const bucket = (h) => {
    if (!byHousehold.has(h)) byHousehold.set(h, { household: h, upserts: [], removals: [] });
    return byHousehold.get(h);
  };

  for (const [id, row] of latest) {
    const household = householdOf.get(id);
    if (!household) continue;   // a row with no household has no sketchbook to land in
    const slug = String(id).split("/").slice(1).join("/");
    const by = String(id).split("/")[0];
    if (row.action === ACTION_WITHDRAW) {
      // No path is computed here. A mark drained in an EARLIER crossing has no
      // declaration in these rows, and its file may sit anywhere the settlement
      // has since re-homed it to — so the removal names the mark, and the git
      // half finds the file by reading the branch's own tree. Guessing a path
      // and force-removing it would silently remove nothing, or the wrong thing.
      bucket(household).removals.push({ id, by, slug });
      continue;
    }
    const p = row.payload ?? {};
    const path = pathOf(id);
    const nested = path
      && path.startsWith(`${ROOT_PREFIX}/`)
      && path.slice(ROOT_PREFIX.length + 1).split("/").length > 2;
    // THE ONE CONVERSION, and only where the file frame differs from the world
    // frame: a nested record's at/points are offsets from its parent's centre.
    // Today every sited/parcel draft lands on open ground at the root
    // (draft-costs-nothing) and every nested record is predicated/naming, which
    // carries no geometry at all — so this is currently identity for every row
    // shape the door can produce. It is written for the general case anyway,
    // because "convert once, at write-down" is the rule and a rule with no code
    // behind it is a comment.
    const framed = nested && typeof toFileFrame === "function" && (p.at || p.points)
      // `path` rides along now, and it is the load-bearing argument: a SITED
      // amend lands on a fossil filing (Gate A) with no `parent_id` in its
      // payload, so a framer that could only read `parent_id` answered "no
      // frame" and let the world coordinate into a relative-framed file raw.
      // That is the 2026-08-27T01:13Z pando-peak defect — see `fileFramer`.
      ? toFileFrame({ at: p.at ?? null, points: p.points ?? null, parent_id: p.parent_id ?? null, path })
      : null;
    const fileRec = { ...p, ...(framed ?? {}) };
    delete fileRec.slug; delete fileRec.body; delete fileRec.parent_id; delete fileRec.household;
    bucket(household).upserts.push({ id, by, slug, path, fileRec, body: String(p.body ?? "") });
  }

  for (const b of byHousehold.values()) {
    b.upserts.sort((a, c) => a.path.localeCompare(c.path));
    b.removals.sort((a, c) => a.id.localeCompare(c.id));
  }

  // Every row crystallizes, mark rows included — see the header. Grouped by the
  // row's OWN crossing, so a drain that spans a boundary splits into the two
  // windows it actually covers rather than filing both under "now".
  const logs = new Map();
  for (const row of rows) {
    const n = Number.isFinite(Number(row.crossing)) ? Number(row.crossing) : 0;
    if (!logs.has(n)) logs.set(n, []);
    logs.get(n).push(logLine(row));
  }
  for (const lines of logs.values()) lines.sort((a, b) => a.seq - b.seq);

  return {
    head,
    households: [...byHousehold.values()].sort((a, b) => a.household.localeCompare(b.household)),
    logs: [...logs.entries()].map(([crossing, lines]) => ({ crossing, lines })).sort((a, b) => a.crossing - b.crossing),
    counts: {
      rows: rows.length,
      marks: [...latest.values()].length,
      upserts: [...byHousehold.values()].reduce((n, b) => n + b.upserts.length, 0),
      removals: [...byHousehold.values()].reduce((n, b) => n + b.removals.length, 0),
    },
  };
}

/**
 * ONE JSONL LINE.
 *
 * `{at, type, actor, seq, payload}` is `crossing-save.mjs`'s own core, kept
 * exactly, so a reader of one file can read the other. The journal's remaining
 * columns ride as named siblings rather than being folded into `payload` —
 * `standing` and `witnesses` in particular are what `the-witnessed-line` puts on
 * every line, and burying a constitutional field inside a payload blob is how it
 * stops being read.
 */
export function logLine(row) {
  return {
    at: row.written_at,
    type: row.action,
    actor: row.actor,
    seq: row.seq,
    class: row.class,
    object: row.object ?? null,
    household: row.household ?? null,
    crossing: row.crossing ?? null,
    standing: row.at ?? null,
    witnesses: row.witnesses ?? null,
    effect: row.effect ?? null,
    payload: row.payload ?? null,
  };
}

// ── the git half ─────────────────────────────────────────────────────────────

const isAncestor = (repo, a, b) => {
  try { git(repo, ["merge-base", "--is-ancestor", a, b]); return true; }
  catch { return false; }
};

/**
 * WHERE THIS HOUSEHOLD'S SKETCHBOOK ACTUALLY IS — the same precedence
 * `ensureDraftCheckout` uses, and for the same reason.
 *
 * A fresh clone has `refs/remotes/origin/draft/<household>` and no local head.
 * Basing off `main` in that case does not start an empty sketchbook, it
 * REPLACES a real one: every draft already pushed to that branch vanishes at the
 * next drain, silently, because the new commit's tree simply does not contain
 * them. This module did exactly that until the smoke against a clone of the live
 * postmark-world caught it — the clone's `origin/draft/keeminlee` held real
 * drafts and the drain based off main.
 *
 * When both exist and the local head is merely BEHIND, origin wins: that is a
 * fast-forward and needs no judgement. When they have DIVERGED, this refuses.
 * Reconciling a divergence is the settlement's arithmetic, not a drain's guess,
 * and refusing is safe — the household's rows stay in the journal and the next
 * drain tries again once somebody has resolved it.
 */
export function sketchbookBase(repo, branch) {
  const local = `refs/heads/${branch}`;
  const remote = `refs/remotes/origin/${branch}`;
  const rev = (r) => git(repo, ["rev-parse", `${r}^{commit}`]).trim();
  const hasLocal = refExists(repo, local);
  const hasRemote = refExists(repo, remote);

  if (!hasLocal && !hasRemote) return { sha: rev(mainRef(repo)), from: "main", hasLocal: false };
  if (!hasLocal) return { sha: rev(remote), from: "origin", hasLocal: false };
  if (!hasRemote) return { sha: rev(local), from: "local", hasLocal: true };

  const l = rev(local), r = rev(remote);
  if (l === r) return { sha: l, from: "local", hasLocal: true };
  if (isAncestor(repo, l, r)) return { sha: r, from: "origin-ahead", hasLocal: true, localSha: l };
  if (isAncestor(repo, r, l)) return { sha: l, from: "local-ahead", hasLocal: true };
  const e = new Error(`sketchbook ${branch} has diverged from origin (local ${l.slice(0, 8)}, origin ${r.slice(0, 8)}) — reconciling that is the settlement's act, not the drain's guess`);
  e.diverged = branch;
  throw e;
}

/** A private index, so nothing here can disturb the clone's real one. */
function withIndex(repo, fn) {
  const dir = mkdtempSync(join(tmpdir(), "postmark-drain-idx-"));
  const indexFile = join(dir, "index");
  try { return fn({ GIT_INDEX_FILE: indexFile }); }
  finally { try { rmSync(dir, { recursive: true, force: true }); } catch { /* litter */ } }
}

/** Every `<dir>/mark.md` in a tree, as a Set — the removal's search space, and the upsert's existence check. */
function treePaths(repo, sha) {
  const out = git(repo, ["ls-tree", "-r", "--name-only", sha, "--", "WORLD/marks"]);
  return new Set(out.split("\n").map((l) => l.trim()).filter((l) => l.endsWith("/mark.md")));
}

/**
 * Where this branch keeps `<by>/<slug>`, verified by reading the record's own
 * `by:`. A slug is unique per AUTHOR, not per tree, so matching on the leaf
 * alone can find somebody else's mark; the extra blob read is the difference
 * between removing the right file and removing a stranger's.
 */
function findMarkPath(repo, sha, paths, { by, slug }) {
  const candidates = [...paths].filter((p) => p.endsWith(`/${slug}/mark.md`));
  for (const p of candidates) {
    try {
      if (readAtRef(repo, sha, p).match(/^by:\s*(.+)$/m)?.[1]?.trim() === by) return p;
    } catch { /* unreadable candidate is not a match */ }
  }
  return null;
}

/**
 * One household's sketchbook, moved forward by one commit — or by none.
 *
 * IDEMPOTENT BY CONSTRUCTION, which is the property the crash story rests on:
 * the tree is built from content, so a re-run that writes the same records
 * produces the same tree sha, and a tree equal to the base's is not committed at
 * all. Re-running an interrupted drain therefore converges rather than piling up
 * empty commits.
 *
 * `whenIso` pins the commit's author and committer dates. Without it the same
 * write-down replayed a second later would be a different sha, and "byte-
 * identical convergence" would be unprovable.
 */
export function writeDownHousehold(repo, { household, upserts, removals }, { whenIso, message, beforeSwap = null }) {
  const branch = draftBranch(household);
  const ref = `refs/heads/${branch}`;
  const { sha: base, from: baseFrom, hasLocal, localSha } = sketchbookBase(repo, branch);
  // Captured before anything can move: the swap's expected old value.
  const expectLocal = hasLocal ? (localSha ?? base) : "0000000000000000000000000000000000000000";
  const baseTree = git(repo, ["rev-parse", `${base}^{tree}`]).trim();
  const paths = treePaths(repo, base);

  const touched = [];
  const tree = withIndex(repo, (env) => {
    git(repo, ["read-tree", base], { env: { ...process.env, ...env } });
    for (const u of upserts) {
      // ── NOTHING MOVES (the freeze, founder-ruled 2026-08-25) ──────────────
      //
      //   "A mark's directory is its historical filing: it carries no claim, and
      //    it never moves again."
      //
      // The plan computes a path for a DECLARATION. This is the only place that
      // can see whether the mark already has a FILE — the base is the household's
      // sketchbook, built on main, so one lookup answers for a published mark and
      // an undrained draft alike. Where it does, that path wins.
      //
      // Without this, the first amend after the door started filing by identity
      // would write a second file at the new path and leave the old one standing:
      // two files, one id — the publish+re-home wedge (#1862), which is exactly
      // what the freeze deleted the mover to prevent. It is not hypothetical:
      // in-flight drafts written before the door changed sit at fossil paths, and
      // an amend is the ordinary next thing to happen to a draft.
      const filed = findMarkPath(repo, base, paths, { by: u.by, slug: u.slug });
      const path = filed ?? u.path;
      // `u.bytes` is a PASSTHROUGH, not a second serializer, and the difference
      // matters because this module's own grammar file exists to stop there
      // being two (`mark-record.mjs`: "two copies of a serialization is how two
      // eras come to disagree about the bytes of the same declaration"). The
      // drain never sets it. The store write-down (G1 lane 3) sets it only when
      // its supplier handed it rendered bytes and no record to re-derive them
      // from — and when the supplier hands BOTH, that caller compares them and
      // refuses on a mismatch before ever reaching here. So the invariant this
      // line preserves is unchanged: any bytes written from a record are written
      // by `markRecord`, once.
      const bytes = u.bytes ?? markRecord(u.fileRec, u.body);
      const blob = execFileSync("git", ["-C", repo, "hash-object", "-w", "--stdin"],
        { input: bytes, encoding: "utf8", env: { ...process.env, ...env } }).trim();
      git(repo, ["update-index", "--add", "--cacheinfo", `100644,${blob},${path}`], { env: { ...process.env, ...env } });
      touched.push({ op: "write", id: u.id, path, blob, ...(filed && filed !== u.path ? { kept_filing: filed, planned: u.path } : {}) });
    }
    for (const r of removals) {
      const path = findMarkPath(repo, base, paths, r);
      // Nothing to remove is a lawful outcome, not a fault: a draft left and
      // withdrawn between two drains never reached a file, and its withdrawal is
      // history in STATE rather than a deletion in the sketchbook.
      if (!path) { touched.push({ op: "remove-absent", id: r.id, path: null }); continue; }
      git(repo, ["update-index", "--force-remove", path], { env: { ...process.env, ...env } });
      touched.push({ op: "remove", id: r.id, path });
    }
    return git(repo, ["write-tree"], { env: { ...process.env, ...env } }).trim();
  });

  if (tree === baseTree) {
    // Nothing to write. If the local head is simply behind origin, move it there
    // anyway — the branch IS origin's tip now, and leaving the local ref stale
    // would make the next drain rebuild this same decision from worse ground.
    if (baseFrom === "origin-ahead" || (!hasLocal && baseFrom === "origin")) {
      git(repo, ["update-ref", ref, base, expectLocal]);
    }
    return { household, branch, base, base_from: baseFrom, commit: base, tree, changed: false, touched };
  }

  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: process.env.BOT_NAME ?? "postmark-office[bot]",
    GIT_AUTHOR_EMAIL: process.env.BOT_EMAIL ?? "office@postmark.invalid",
    GIT_COMMITTER_NAME: process.env.BOT_NAME ?? "postmark-office[bot]",
    GIT_COMMITTER_EMAIL: process.env.BOT_EMAIL ?? "office@postmark.invalid",
    GIT_AUTHOR_DATE: whenIso,
    GIT_COMMITTER_DATE: whenIso,
  };
  const commit = execFileSync("git", ["-C", repo, "commit-tree", tree, "-p", base, "-m", message],
    { encoding: "utf8", env }).trim();

  // COMPARE-AND-SWAP. If the branch moved under us — another drain, a settlement
  // rebase, an operator — this refuses instead of erasing their work. A refused
  // household leaves the cursor where it is, so its rows are still in the
  // journal and the next drain tries again against the new tip.
  //
  // `beforeSwap` exists so that guarantee can be falsified: the race window is
  // the microseconds between reading `base` and moving the ref, and a test that
  // cannot open that window can only assert that an argument was passed. It is
  // a test seam, like `failAt`, and nothing in production supplies it.
  if (typeof beforeSwap === "function") beforeSwap({ household, ref, base, commit });
  // The expected old value is the LOCAL head as it stood when this function
  // decided, which is what the swap is racing for. It comes from
  // `sketchbookBase` rather than a fresh `rev-parse`: re-reading it here would
  // read it AFTER the race window and cheerfully confirm whatever the other
  // writer just put there — a compare-and-swap that compares against the thing
  // it is supposed to detect. With no local head yet the expectation is the zero
  // sha, which makes the swap a create-if-absent.
  git(repo, ["update-ref", ref, commit, expectLocal]);

  return { household, branch, base, base_from: baseFrom, commit, tree, changed: true, touched };
}

// ── the STATE half ───────────────────────────────────────────────────────────

const stableJson = (v) => `${JSON.stringify(v, null, 2)}\n`;

/** Write through a temp file and rename: a reader never sees half a log, and a crash never leaves one. */
function atomicWrite(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path) && readFileSync(path, "utf8") === text) return false;
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, path);
  return true;
}

/**
 * One crossing's journal window.
 *
 * MERGED BY SEQ, NOT APPENDED. A drain writes rows 1–5 and truncates; the next
 * writes 6–10 into the same crossing's file. Appending would be correct until a
 * crash re-ran a half-written append and doubled the lines. Reading the file
 * back, merging by `seq` and rewriting whole makes the result a function of
 * (what was already crystallized, what is being crystallized now) — which is
 * what makes an interrupted run converge to the same bytes.
 */
export function writeJournalWindow(stateDir, crossing, lines, { asOfWorld = null } = {}) {
  const logPath = join(stateDir, "log", `${crossing}.journal.jsonl`);
  const metaPath = join(stateDir, "log", `${crossing}.journal.meta.json`);

  const bySeq = new Map();
  if (existsSync(logPath)) {
    for (const raw of readFileSync(logPath, "utf8").split("\n")) {
      if (!raw.trim()) continue;
      try { const l = JSON.parse(raw); if (Number.isFinite(l?.seq)) bySeq.set(l.seq, l); } catch { /* a line this cannot read is not a line we can merge */ }
    }
  }
  for (const l of lines) bySeq.set(l.seq, l);
  const merged = [...bySeq.values()].sort((a, b) => a.seq - b.seq);

  const counts = {};
  for (const l of merged) counts[l.type] = (counts[l.type] ?? 0) + 1;
  const meta = {
    crossing,
    source: "dynamic.db/journal",
    grammar: "one line per journal row, in seq order; `standing` and `witnesses` are the-witnessed-line's anchor+offset, pinned at the write instant and carried here unchanged",
    as_of_world: asOfWorld,
    first_seq: merged.length ? merged[0].seq : null,
    last_seq: merged.length ? merged.at(-1).seq : null,
    event_count: merged.length,
    counts,
  };

  const wrote = [];
  if (atomicWrite(logPath, merged.map((l) => JSON.stringify(l)).join("\n") + (merged.length ? "\n" : ""))) wrote.push(logPath);
  if (atomicWrite(metaPath, stableJson(meta))) wrote.push(metaPath);
  return { logPath, metaPath, wrote, meta };
}

/**
 * THE PUBLIC LEDGERS, materialized from the journal at the save.
 *
 * Ruled 2026-08-22: "walks + enter-exit should settle at the save, not per-act
 * to git main." Every walk and every crossing used to spend one commit on main.
 * Behind WORLD_SINGLE_LOG the acts write a journal row instead, and this is
 * where the record receives them — once, with everything else the save writes.
 *
 * APPENDS THE LINES VERBATIM. The rows carry the exact text the acting pen
 * formatted (`payload.lines`), so this does not re-derive a single character.
 * That is what makes "the record carries the same lines the per-act commits
 * would have" true by construction rather than by two formatters agreeing —
 * the lesson slice 2 paid for when one serialization had two homes.
 *
 * IN SEQ ORDER, ACROSS LEDGERS. The journal's own order is the order the acts
 * happened in, and both ledgers are append-only records of a sequence; sorting
 * by anything else would put a resident's exit before the entry it answers.
 *
 * IDEMPOTENT, like everything else the drain does before the truncate: a line
 * already present in the ledger is not appended twice, so a crash between the
 * write-down and the truncate replays to the same file.
 *
 * ── THE ENTER/EXIT RECORD IS NOT ONE OF THESE, AND MUST NOT BE (#2152) ──────
 *
 * The passage record stopped being a file anybody appends to on 2026-08-26. It
 * is DERIVED at read time office-side — the frozen era from the clone plus the
 * journal's rows — and the world repo's own law, `tools/enter-exit-record.test.
 * mjs`, says what its committed copy must be, quoted verbatim:
 *
 *     "the world repo has no journal to read — a longer derived file means a
 *      hand wrote in it"
 *
 * So the committed copy is the frozen era EXACTLY, 155 act-lines, forever. Two
 * office pens went on appending live passages into it anyway — this loop and
 * the crossing-save's emit — and each append turned the world's grammar suite
 * red, which cost the settlement sweep its ability to attribute a failure to a
 * candidate and refused the whole crossing. Three hand-repairs (world main
 * 06c741d5, fd801ebe, and the instance before them) before the writers were
 * found.
 *
 * The filter is EXPLICIT rather than incidental. A production clone happens not
 * to be missing these files, so the "no such ledger in this clone" branch below
 * would not have caught this; and a filter that works only because a file is
 * absent is a filter that comes back the day somebody adds the file.
 *
 * WALK LEDGER LINES STILL ROUTE. `WORLD/walk-ledger.md` is a committed
 * append-only record with no deriver — this is its only pen, and it is lawful.
 * That is the whole reason this loop survives at all.
 *
 * (World 2.0's database migration supersedes this seam; until it lands, the
 * passage record has exactly one writer and it is the reader.)
 */
export function materializeLedgers(repo, rows) {
  const byLedger = new Map();
  for (const row of rows) {
    const ledger = row?.payload?.ledger;
    const lines = row?.payload?.lines;
    if (!ledger || !Array.isArray(lines) || !lines.length) continue;
    if (LEDGER_NAMES.includes(String(ledger).replace(/\\/g, "/"))) continue;   // #2152 — derived, never appended
    if (!byLedger.has(ledger)) byLedger.set(ledger, []);
    for (const line of lines) byLedger.get(ledger).push({ seq: row.seq, line: String(line) });
  }

  const wrote = [];
  for (const [ledger, entries] of byLedger) {
    entries.sort((a, b) => a.seq - b.seq);
    const path = join(repo, ledger);
    if (!existsSync(path)) {
      // The ledgers are founding files with their own headers, written by the
      // world repo. A save does not invent one: a missing ledger means this
      // clone is not the world these lines belong to, and appending would
      // create a headerless file the parsers refuse.
      wrote.push({ ledger, appended: 0, skipped: entries.length, note: "no such ledger in this clone — nothing appended" });
      continue;
    }
    const prev = readFileSync(path, "utf8");
    const have = new Set(prev.split("\n"));
    const fresh = entries.map((e) => e.line).filter((line) => !have.has(line));
    if (!fresh.length) { wrote.push({ ledger, appended: 0, already: entries.length }); continue; }
    const sep = prev.endsWith("\n") ? "" : "\n";
    writeFileSync(path, `${prev}${sep}${fresh.join("\n")}\n`, "utf8");
    wrote.push({ ledger, appended: fresh.length, ...(fresh.length < entries.length ? { already: entries.length - fresh.length } : {}) });
  }
  return wrote;
}

/**
 * THE COLD ARCHIVE, wired at the save — §5's own condition.
 *
 * `tools/state-to-r2.mjs` has been proven and deliberately UNWIRED since
 * 2026-08-22 ("Deliberately NOT wired into settlement-auto.sh or crossing-save
 * tonight — run by hand after a save/settlement; a timer is the follow-up").
 * §5's condition was that it wires AT THE SAVE rather than on a timer of its
 * own, and this is that wire: the save has just written STATE, so the save is
 * the one moment the bytes are known good and known complete.
 *
 * THE RECORD IS GIT-TRUTH; R2 IS A MIRROR. A failed upload is DISCLOSED and
 * never blocks: the crossing's record lives in the repo, the archive is a copy
 * of it, and a copy that did not land is a thing to retry — never a reason to
 * refuse a settlement that has already written the truth. That asymmetry is the
 * whole reason this is safe to wire at all.
 *
 * `run` is the seam: the default spawns the proven tool as its own process, and
 * a test passes a stub. Injected rather than imported because the tool is a CLI
 * that calls `process.exit`, and refactoring a proven archiver to make it
 * testable would be changing the thing under test to suit the test.
 */
export async function archiveToR2({ repo, stateDir, run = null } = {}) {
  const runner = run ?? (async () => {
    const { execFileSync } = await import("node:child_process");
    const out = execFileSync(process.execPath, [join(HERE_TOOLS, "state-to-r2.mjs")], {
      encoding: "utf8",
      env: { ...process.env, WORLD_CLONE: repo },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { output: String(out).trim().split("\n").at(-1) ?? "" };
  });
  try {
    const r = await runner({ repo, stateDir });
    return { archived: true, ...(r ?? {}) };
  } catch (e) {
    // NAMED, NOT THROWN. The operator learns the mirror is behind; the
    // settlement does not learn anything at all, because the settlement's work
    // is already on disk.
    return {
      archived: false,
      reason: String(e?.message ?? e).slice(0, 200),
      note: "the record is git-truth and it is written; R2 is a mirror and it is behind — retry the archive, nothing here needs re-running",
    };
  }
}

// ── the frame conversion, read at a ref ──────────────────────────────────────

/**
 * The clone's own `worldToFile`, plus the composed centres it needs — or null
 * when the tree is not relative or the fold cannot be read.
 *
 * Null means DO NOT CONVERT, and that is the safe answer: an unconverted
 * root-level record is exactly right, and a converted-by-guesswork nested one is
 * a mark in the wrong place forever.
 */
/**
 * ── THE FRAME BUG, AND WHY THIS FUNCTION GREW A SECOND WAY IN (2026-08-27) ────
 *
 * On 2026-08-27T01:13:12.971Z an amend of `vermillion/the-pando-peak` was
 * drained, and the record that landed said:
 *
 *   at: { x: -95458, y: -95458 }        (was: at: { x: 0, y: 0 })
 *
 * at `WORLD/marks/let-there-be-light/pando-peak/the-pando-peak/mark.md` — a
 * FOSSIL path, nested under the `pando-peak` region, whose composed centre IS
 * (-95458, -95458). So the file's own frame added the offset a second time and
 * the mountain composed to roughly (-190916, -190916), ~95km outside the world.
 * Eleven vessel/timetable tests went red at 03:22:57Z — the landing stands on
 * that peak — and the crossing published nothing for anybody until a human
 * reverted it by hand at 03:50Z.
 *
 * THE RESIDENT MOVED NOTHING. They restated their mountain's true WORLD
 * position, which is what the journal stores by design ("a declaration is stored
 * in world coordinates as the resident spoke them"). The machinery moved it.
 *
 * The mechanism, exactly: `planDrain` DID decide the row was nested — Gate A
 * hands an amend its frozen fossil filing, which is three segments deep — and
 * DID call this framer. But the framer could only answer from `parent_id`, and a
 * SITED mark carries no `parent_id` in the door's grammar; only predicated and
 * naming marks do. So `origin` came back null, the conversion returned `{}`, and
 * the world coordinate went into a relative-framed file raw.
 *
 * Which is why the sited/parcel arm was believed unreachable. The drain's own
 * comment said "this is currently identity for every row shape the door can
 * produce", and `world-drain.test.mjs` has a test whose name asserts the frame
 * conversion "has no live caller at this door". Both were reasoning about a
 * CREATE, where Gate B files at the id and the path really is root-level. Nobody
 * re-checked them against an AMEND, where Gate A hands back a fossil. The
 * premise was true when written, the freeze made it false on 2026-08-25, and the
 * comment went on being read as current.
 *
 * THE FIX: the origin is resolved from the PATH THE RECORD IS ACTUALLY WRITTEN
 * TO, and `parent_id` becomes the fallback rather than the only way in. The path
 * is the honest source — it is what the fold will compose against — and it is
 * available for free, because `filing-freeze.json` is a map of id → directory
 * and inverting it gives directory → id.
 *
 * Null still means DO NOT CONVERT, and still for the same reason: an unconverted
 * root-level record is exactly right, and a converted-by-guesswork nested one is
 * a mark in the wrong place forever.
 */
export async function fileFramer(repo) {
  let fold, state, rootRecord;
  try {
    const dir = materializeAtRef(repo, mainRef(repo), "tools");
    fold = await import(pathToFileURL(join(dir, "tools", "marks-fold.mjs")));
    state = JSON.parse(readAtRef(repo, mainRef(repo), "WORLD/world-state.json"));
    // THE ROOT RECORD, NOT THE FOLDED STATE. `coords: relative` is a field on
    // the root mark's `mark.md`; the fold does not carry it through to
    // `world-state.json`, so reading the declaration there finds `undefined` on
    // the real world and quietly concludes the tree is absolute. This module did
    // exactly that until the smoke against the live record caught it. Today the
    // conversion is identity for every row shape the door can produce, so the
    // bug would have cost nothing and waited — which is the worst kind.
    // `leave-exec.mjs` gets this right by reading raw records; this reads the
    // one raw record it needs, at the ref.
    rootRecord = readAtRef(repo, mainRef(repo), `${ROOT_PREFIX}/mark.md`);
  } catch { return null; }
  if (typeof fold.worldToFile !== "function") return null;
  const declared = String(rootRecord ?? "").match(new RegExp(`^${fold.COORDS_FIELD}:\\s*(.+)$`, "m"))?.[1]?.trim();
  const relative = fold.COORDS_FIELD && declared === fold.COORDS_RELATIVE;
  if (!relative) return null;
  const centre = new Map((state?.marks ?? []).filter((m) => m?.id && m.at).map((m) => [m.id, m.at]));

  // DIRECTORY → the mark that owns it, inverted out of the fossil manifest. The
  // manifest is keyed id → directory and is never regenerated, so this is exact
  // for every mark alive on the freeze date and costs one read. A mark born
  // AFTER the freeze is filed at `WORLD/marks/<household>/<slug>/`, is not
  // nested, and needs no entry here — which is why an absent one is not a gap.
  let mainSha = null;
  try { mainSha = git(repo, ["rev-parse", mainRef(repo)]).trim(); } catch { /* named absent below */ }
  const idOfMarkFile = mainSha ? idOfMarkFileFrom(frozenFilingAt(repo, mainSha)) : new Map();

  /**
   * The composed centre the FILE at `path` is framed on — the nearest enclosing
   * mark, walking the path's own directory ancestors.
   *
   * The floor is `depth > 3`, which is the floor `settlement-sweep.mjs`'s
   * `enclosingMarkId` walks to, and the two have to agree about what an ancestor
   * IS or the drain frames against one parent and the fold composes against
   * another. Segments: WORLD / marks / <first> / …dirs… / <slug> / mark.md, and
   * that `<first>` segment is never a mark's parent — under the fossil tree it
   * is the world root (which is the frame, so subtracting it is identity) and
   * under the id-keyed layout it is a household namespace with no mark.md in it.
   */
  const originForPath = (path) => {
    const parts = String(path).replace(/\\/g, "/").split("/");
    for (let depth = parts.length - 2; depth > 3; depth--) {
      const ancestor = `${parts.slice(0, depth).join("/")}/mark.md`;
      const id = idOfMarkFile.get(ancestor);
      const at = id ? centre.get(id) : null;
      if (at) return at;
    }
    return null;
  };

  const toFileFrame = ({ at, points, parent_id, path = null }) => {
    // THE PATH FIRST. It is where the record is actually going, so it is what
    // the fold will compose it against; `parent_id` is a claim the payload makes
    // and only predicated/naming marks make it at all.
    const origin = (path ? originForPath(path) : null) ?? (parent_id ? centre.get(parent_id) : null);
    if (!origin) return {};
    return {
      ...(at ? { at: fold.worldToFile(at, origin) } : {}),
      ...(points && fold.ringToFile ? { points: fold.ringToFile(points, origin) } : {}),
    };
  };

  // ── THE DECLARED PARENT, RIDING THE SAME FRAMER (postmark#3020) ────────────
  //
  // The framer converts faithfully, which is the whole of the 2026-09-18 fix and
  // is not in question. What it cannot do alone is notice that the number it was
  // handed does not belong at the path it is framing FOR — the Snug mooring, a
  // world point five kilometres from the harbour it is filed in, converted
  // correctly into a file that then said the opposite of the truth.
  //
  // So the framer also hands back the two things the guard needs and nothing
  // else can supply at this ref: the path's declared parent AS THE LAST FOLD
  // COMPOSED IT, and the clone's own `pointWithinMark`. They ride as properties
  // rather than a second return value because `toFileFrame(...)` has callers,
  // and a signature change here is a signature change at every one of them.
  //
  // A clone whose tools do not carry `pointWithinMark` leaves it undefined, and
  // the guard admits — the office does not grow a local definition of "inside".
  const markOfId = new Map((state?.marks ?? []).filter((m) => m?.id).map((m) => [m.id, m]));
  toFileFrame.declaredParentOf = (path) => {
    const parentId = declaredParentIdOf(path, idOfMarkFile);
    return parentId ? { parentId, parent: markOfId.get(parentId) ?? null } : null;
  };
  // THE MARK AS IT STANDS — the crossing's half of the narrowing. The door has
  // `priorLive ?? priorCanon`; here the last published fold IS the prior, and it
  // is in world coordinates exactly as a world-framed row's numbers are, so the
  // two are comparable without a conversion. Absent means the mark is not
  // standing, and an amend of a mark that is not standing is admitted rather
  // than refused — the same direction every other arm of this guard takes.
  toFileFrame.standingMark = (id) => markOfId.get(String(id)) ?? null;
  try {
    const dir = materializeAtRef(repo, mainRef(repo), "tools");
    const verbs = await import(pathToFileURL(join(dir, "tools", "world-verbs.mjs")));
    if (typeof verbs.pointWithinMark === "function") toFileFrame.pointWithinMark = verbs.pointWithinMark;
  } catch { /* named absent by its own undefined — the guard admits rather than inventing a predicate */ }
  return toFileFrame;
}

// ── the drain ────────────────────────────────────────────────────────────────

export function drainStatus(db) {
  const cursor = Number(getMeta(db, DRAIN_CURSOR) ?? 0);
  const head = journalHead(db);
  return { cursor, head, pending: Math.max(0, head - cursor) };
}

/**
 * THE ACT.
 *
 * Refuses without `WORLD_SINGLE_LOG=1`: the drain and the pen that fills the
 * journal are one switch, and a drain running against an office that is still
 * writing to git would truncate a journal nobody is filling while the real
 * writes go somewhere else.
 *
 * `failAt` is the crash falsifier's instrument — the seam names are the ones the
 * header enumerates. Nothing in production passes it.
 */
export async function drain({
  repo = WORLD_CLONE,
  dbPath = null,
  at = Date.now(),
  stateDir = null,
  commitState = false,
  failAt = null,
  beforeSwap = null,
  // §5's seam: a function runs the archive, `false` skips it entirely (the
  // fixtures' default — a test must not reach for a bucket), omitted spawns the
  // proven tool.
  archiveR2 = false,
  // THE STALE-JOURNAL OVERRIDE (below): the operator's reason, or none.
  staleOk = process.env.SETTLEMENT_DRAIN_STALE_OK ?? null,
} = {}) {
  if (!singleLogEnabled())
    return { refused: "flag-off", detail: "the drain runs only under WORLD_SINGLE_LOG=1 — the journal's pen and its drain are one switch" };
  if (!existsSync(join(repo, "WORLD")))
    return { refused: "world-clone", detail: `no WORLD/ under ${repo} — this is not a world checkout` };

  const whenIso = new Date(at).toISOString();
  const STATE = resolve(stateDir ?? join(repo, "STATE"));
  const db = openDynamic(dbPath ?? undefined);

  try {
    const before = drainStatus(db);
    const rows = readJournal(db, { sinceSeq: before.cursor });
    if (!rows.length) {
      return { drained: 0, cursor: before.cursor, head: before.head, households: [], windows: [], at: whenIso, note: "nothing to drain — the cursor is the law" };
    }

    // ── A NON-EMPTY JOURNAL IS STALE, AND THE DRAIN SAYS SO (POS-269) ────────
    //
    // Nothing has written this sqlite journal since G1 (2026-09-22) and the
    // town's settlement reads the store (SETTLEMENT_SOURCE=store). This drain
    // runs only on the git road, which is the rollback. On 2026-09-30 prod's own
    // panel counted 5,197 rows here (head 6733, drained through 1536, newest
    // 2026-09-27): a rollback would have poured all of them into sketchbooks at
    // the next crossing, weeks late and under the git road's judgement. So any
    // row found here refuses the drain, by count, before anything is written.
    //
    // THE OPERATOR OVERRIDE (our own guards never block a fix, Wright
    // 2026-09-30): SETTLEMENT_DRAIN_STALE_OK="<reason>" drains them anyway. The
    // reason is logged on stderr and carried in the report, so the choice is on
    // the record beside what it did.
    const reason = String(staleOk ?? "").trim();
    if (!reason) {
      return {
        refused: "stale-journal",
        count: rows.length,
        detail: `${rows.length} undrained row(s) in the retired sqlite journal (seq ${rows[0].seq}–${rows.at(-1).seq}, the newest written ${rows.at(-1).writtenAt ?? rows.at(-1).written_at ?? "at an unknown instant"}). Nothing writes this journal since G1, so draining them now would publish weeks-old acts under today's crossing. To drain them anyway, set SETTLEMENT_DRAIN_STALE_OK="<your reason>" — the reason is logged and rides the report`,
      };
    }
    console.error(`[world-drain] OVERRIDE SETTLEMENT_DRAIN_STALE_OK="${reason}" — draining ${rows.length} stale row(s) from the retired sqlite journal (seq ${rows[0].seq}–${rows.at(-1).seq})`);

    let asOfWorld = null;
    try { asOfWorld = git(repo, ["rev-parse", mainRef(repo)]).trim(); } catch { /* named absent below */ }
    const toFileFrame = await fileFramer(repo);
    // Memoized: the tree at a commit is immutable, and this used to run an
    // `ls-tree` over the whole marks tree per lookup. It is consulted only for a
    // withdrawal whose declaration was drained in an earlier window, so on most
    // runs the listing is never built at all.
    const mainSha = asOfWorld;
    let mainPaths = null;
    const publishedPathOf = (id) => {
      if (!mainSha) return null;
      // THE FOSSIL MANIFEST FIRST (the freeze, 2026-08-25). `filing-freeze.json`
      // is keyed by full id and never regenerated, so for the 960 marks alive on
      // the freeze date it is the exact answer to "where is this already filed"
      // — and it costs one JSON read instead of a walk over the whole tree.
      const frozen = frozenFilingAt(repo, mainSha).get(String(id));
      if (frozen) return frozen;
      mainPaths ??= treePaths(repo, mainSha);
      return findMarkPath(repo, mainSha, mainPaths, {
        by: String(id).split("/")[0],
        slug: String(id).split("/").slice(1).join("/"),
      });
    };

    const plan = planDrain(rows, { publishedPathOf, toFileFrame });
    trip(failAt, "after-plan");

    // ── the write-down ───────────────────────────────────────────────────────
    const households = [];
    for (const h of plan.households) {
      // A household whose sketchbook has diverged from origin refuses; the rest
      // still drain. Its rows stay in the journal because the cursor only moves
      // for a run that completed, so nothing is lost — but the run as a whole
      // must not truncate, so the refusal propagates.
      households.push(writeDownHousehold(repo, h, {
        whenIso, beforeSwap,
        message: `drain: ${h.upserts.length} declared, ${h.removals.length} withdrawn — ${h.household} (journal seq ≤ ${plan.head})`,
      }));
      trip(failAt, `after-household:${h.household}`);
    }
    trip(failAt, "after-write-down");

    const windows = plan.logs.map(({ crossing, lines }) => writeJournalWindow(STATE, crossing, lines, { asOfWorld }));
    // THE PUBLIC LEDGERS, from the same rows, in the same act. A walk or a
    // crossing that declared itself into the journal receives its line here
    // rather than having spent a commit of its own when it happened.
    const ledgers = materializeLedgers(repo, rows);
    trip(failAt, "after-state");

    // §5, wired at the save and nowhere else. After the write-down, so the bytes
    // it mirrors are the ones this save just made good; never in the way, so a
    // bucket that is down cannot cost the town a settlement.
    const archive = archiveR2 === false ? null : await archiveToR2({ repo, stateDir: STATE, run: archiveR2 || null });

    let stateCommit = null, stateNote = null;
    if (commitState) {
      // Opt-in, and it refuses rather than fighting for the tree: STATE lives on
      // main, the clone's checkout belongs to whoever else is using it, and a
      // drain that switched branches to commit would be exactly the checkout
      // this ladder retires. Default off, so the settlement pass owns it.
      const onMain = git(repo, ["branch", "--show-current"]).trim();
      const dirty = git(repo, ["status", "--porcelain", "--", STATE]).trim();
      if (onMain !== "main") stateNote = `not committed: the clone stands on "${onMain}", not main`;
      else if (!dirty) stateNote = "nothing to commit: STATE is unchanged";
      else {
        const { penCommit } = await import("./write.mjs");
        // The ledgers ride the SAME commit as STATE: one save, one commit, which
        // is the whole point of settling at the save rather than per act.
        const paths = [STATE, ...ledgers.filter((l) => l.appended > 0).map((l) => join(repo, l.ledger))];
        stateCommit = penCommit(repo, paths, `drain: journal windows ${plan.logs.map((l) => l.crossing).join(", ")} (seq ≤ ${plan.head})`);
      }
    }

    trip(failAt, "before-truncate");

    // ── THE TRUNCATE ─────────────────────────────────────────────────────────
    // The delete and the cursor advance are ONE transaction. This is the only
    // irreversible step in the whole act, and it runs only after the write-down
    // is on disk — so the journal has been a superset of the record from the
    // first line of this function to this one.
    //
    // A household whose ref refused the compare-and-swap would have thrown
    // above, before reaching here, leaving its rows in the journal for the next
    // run. Nothing is truncated that was not written down.
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM journal WHERE seq <= ?").run(plan.head);
      db.prepare("INSERT OR REPLACE INTO meta VALUES (?, ?)").run(DRAIN_CURSOR, String(plan.head));
      db.exec("COMMIT");
    } catch (e) {
      try { db.exec("ROLLBACK"); } catch { /* the transaction is already gone */ }
      throw e;
    }
    trip(failAt, "after-truncate");

    putMeta(db, "last_drain_at", whenIso);
    putMeta(db, "last_drain_head", String(plan.head));

    const after = drainStatus(db);
    return {
      drained: plan.counts.rows,
      at: whenIso,
      cursor: after.cursor,
      head: after.head,
      remaining: after.pending,
      counts: plan.counts,
      as_of_world: asOfWorld,
      households: households.map(({ household, branch, base, base_from, commit, changed, touched }) =>
        ({ household, branch, base, base_from, commit, changed, touched })),
      windows: windows.map((w) => ({ crossing: w.meta.crossing, events: w.meta.event_count, first_seq: w.meta.first_seq, last_seq: w.meta.last_seq, wrote: w.wrote })),
      state_dir: STATE,
      ledgers,
      ...(archive ? { archive } : {}),
      override: { stale_journal: reason },
      state_commit: stateCommit,
      state_note: stateNote ?? (commitState ? null : "STATE written to the working set only — committing it is the settlement pass's act, or pass --commit-state"),
    };
  } finally { try { db.close(); } catch { /* already gone */ } }
}

// ── the CLI ──────────────────────────────────────────────────────────────────

if (process.argv[1]?.endsWith("world-drain.mjs")) {
  const argOf = (n, d = null) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : d; };
  const flag = (n) => process.argv.includes(n);
  const atIso = argOf("--at", null);
  const at = atIso ? Date.parse(atIso) : Date.now();
  if (!Number.isFinite(at)) { console.error(`unparseable --at: ${atIso}`); process.exit(2); }
  const report = await drain({
    repo: resolve(argOf("--world", process.env.WORLD_CLONE ?? WORLD_CLONE)),
    dbPath: argOf("--db", null),
    stateDir: argOf("--state", null),
    at,
    commitState: flag("--commit-state"),
  });
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.refused ? 1 : 0);
}
