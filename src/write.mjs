// write.mjs — the write spine (gold plan postmark-doors, P2).
//
// One job: turn a validated POST /letters payload into a letter file in the
// sender's outbox, landed as a bot commit on the office's own town clone.
// The ferry delivers on its own cadence — the office accepts mail, it never
// delivers it. Push is env-gated so dev smoke can prove the whole path
// without touching the real town.
//
// Env: TOWN_CLONE (path), TOWN_PUSH=1 to push, BOT_NAME / BOT_EMAIL.

import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync, rmSync, readdirSync, rmdirSync, realpathSync } from "node:fs";
import { dirname, join, relative, isAbsolute, resolve } from "node:path";

import { nextCrossingAt, nextCrossingForReceipt } from "./crossings.mjs";

const MAX_BODY = 100_000; // size courtesy (bytes of markdown body)

const slugify = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "letter";

// The bounce vocabulary, one factory for the whole spine: `{ code, defect, hint }`
// on an Error, which is the shape both doors catch and turn into an answer.
const bounce = (code, defect, hint) => { const e = new Error(defect); Object.assign(e, { code, defect, hint }); return e; };

// ONE CLOCK (postmark#2922). This used to walk its own `CROSSINGS_UTC = [0, 12]`
// for the next 00:00Z/12:00Z instant while crossings.mjs counted the same
// beats from the ledger's epoch — two files, one clock, and a doorstep that
// could name a different boat than the receipt did. The instant is derived
// there now; the signature and the answer here are unchanged (a strictly
// future 00:00Z or 12:00Z, as test/write.test.mjs pins).
export function nextCrossing(now = new Date()) {
  return nextCrossingAt(now instanceof Date ? now.getTime() : now);
}

const git = (clone, ...args) =>
  execFileSync("git", ["-C", clone, ...args], { encoding: "utf8" }).trim();

// ── WHOLE OR NOTHING (POS-296) ───────────────────────────────────────────────
//
// A write that answers "failed" leaves nothing behind in the clone. Before this,
// three shapes of residue were possible, and each one lied to somebody:
//   · an appended or created file with no commit (the exec refused after the
//     write): the next write's `pull --rebase` refused on it, so one refusal
//     became an outage of every pen (the 2026-09-28 dirty clone, 4.5 hours);
//   · a commit that never landed (the push lost its race three times): the
//     resident was told no, and the next write's push carried the row anyway;
//   · an untracked letter file: the resident's re-send bounced 409.
//
// `penTransaction` records HEAD and the dirt already present, runs `fn`, and
// on a throw or an `{ error }` answer puts back every path `fn` changed:
// tracked paths return to HEAD's bytes, created paths are removed. A commit
// that `fn` made and that is not on the remote is unmade first. When the push
// could not land, the clone is then rebased onto the fetched origin/main, so it
// matches the town rather than standing behind it.
//
// Two limits, named. A commit that LANDED is never unmade — it is the town's
// now, and a later failure in the same act cannot take it back. And a process
// killed outright (SIGKILL, OOM, a reboot) runs no JS; the ferry's
// `reset --hard` + `clean` at every crossing stays the backstop for that.

/** The marker on the error a push that cannot land throws. The drain holds
 *  its cursor on it (town-bridge.mjs); a door answers it in these words. */
export const NOT_LANDED = "not-landed";

export const notLandedError = (detail) => Object.assign(
  new Error(`pen push did not land: ${detail}`),
  {
    code: 503,
    pen: NOT_LANDED,
    defect: "the town did not take this write",
    hint: "the office lost its race with other town traffic three times, so nothing was recorded and nothing is left behind — the same request is safe to make again",
  },
);

/** For an exec that answers one JSON line: run the pen, and turn a push that
 *  could not land into the refusal the exec prints (a bounce is an answer),
 *  not a machinery trip. Any other throw is still the machinery's. */
export function landOrRefuse(land) {
  try { return land(); }
  catch (e) {
    if (e?.pen !== NOT_LANDED) throw e;
    return { error: { code: e.code, defect: e.defect, hint: e.hint } };
  }
}

const pushing = () => process.env.TOWN_PUSH === "1";

// Every changed path under the pathspecs, relative to the clone's root, one
// file per entry: tracked (modified, added, deleted) and, unless asked not to,
// untracked. Read-only (`--no-optional-locks`: a plain status rewrites the index).
function changedPaths(clone, pathspecs = [], { untracked = true } = {}) {
  const out = execFileSync("git", ["-C", clone, "--no-optional-locks", "status", "--porcelain=v1", "-z",
    `--untracked-files=${untracked ? "all" : "no"}`, "--no-renames", "--", ...pathspecs], { encoding: "utf8" });
  return out.split("\0").filter(Boolean).map((entry) => entry.slice(3));
}

// A commit is landed when the remote holds it. With no push there is no
// remote to hold it, so every commit this office made is local.
function landed(clone, sha) {
  if (!pushing()) return false;
  try { git(clone, "merge-base", "--is-ancestor", sha, "origin/main"); return true; }
  catch { return false; }
}

// A rebase the push loop started and could not finish is aborted first, or
// every command below would be answering about a half-applied commit.
function abortRebase(clone) {
  const gitDir = resolve(clone, git(clone, "rev-parse", "--git-dir"));
  if (existsSync(join(gitDir, "rebase-merge")) || existsSync(join(gitDir, "rebase-apply")))
    try { git(clone, "rebase", "--abort"); } catch { /* reported by the restore's own reads */ }
}

// Remove a file this act created, and the directories it left empty.
function removeCreated(clone, rel) {
  const root = resolve(clone);
  rmSync(join(root, rel), { force: true });
  for (let dir = dirname(join(root, rel)); dir.startsWith(root) && dir !== root; dir = dirname(dir)) {
    try { if (readdirSync(dir).length) break; rmdirSync(dir); } catch { break; }
  }
}

/**
 * Put the clone back at `recorded` for exactly `paths` (pathspecs: files or
 * directories, relative to the clone), and unmake any commit after `recorded`
 * that the remote does not hold.
 *
 * Pushing, with no tracked dirt anywhere (the pull and the push loop's rebase
 * both refuse to run over any, so this is the ordinary case): `reset --hard`
 * to the recorded HEAD, then rebase onto the fetched origin/main, so the clone
 * matches the town. Otherwise the commit is unmade with `--soft` and only the
 * named paths are put back, so dirt this act did not make is never touched.
 */
function restore(clone, recorded, paths) {
  abortRebase(clone);
  const head = git(clone, "rev-parse", "HEAD");
  if (head !== recorded && !landed(clone, head)) {
    if (pushing() && !changedPaths(clone, [], { untracked: false }).length) {
      git(clone, "reset", "-q", "--hard", recorded);
      try { git(clone, "rebase", "-q", "origin/main"); }
      catch { try { git(clone, "rebase", "--abort"); } catch { /* stands at recorded */ } }
    } else {
      git(clone, "reset", "-q", "--soft", recorded);
    }
  }
  if (!paths.length) return;
  const dirty = changedPaths(clone, paths);
  if (!dirty.length) return;
  const inHead = new Set(execFileSync("git", ["-C", clone, "ls-tree", "-r", "--name-only", "-z", "HEAD", "--", ...dirty],
    { encoding: "utf8" }).split("\0").filter(Boolean));
  const tracked = dirty.filter((p) => inHead.has(p));
  const created = dirty.filter((p) => !inHead.has(p));
  if (tracked.length) git(clone, "checkout", "-q", "HEAD", "--", ...tracked);
  if (created.length) {
    git(clone, "rm", "-q", "--cached", "--ignore-unmatch", "--", ...created);
    for (const rel of created) removeCreated(clone, rel);
  }
}

const relTo = (clone, p) => {
  const r = isAbsolute(p) ? relative(resolve(clone), p) : p;
  return r.replace(/\\/g, "/") || ".";
};

/**
 * Run one write whole or not at all. `fn` may be sync or async; it answers,
 * throws, or answers `{ error }`. On a throw or an error answer every path it
 * changed is put back (see `restore`), then the throw is rethrown or the
 * answer returned unchanged. Dirt present before `fn` ran is left alone.
 */
export function penTransaction(clone, fn) {
  // No clone, or no git in it, is nothing a restore could protect: the write
  // either bounces before the clone is touched (a door's own checks) or fails
  // at the pen the way it always did. Run it as it is.
  let recorded, before;
  try {
    if (!clone || !existsSync(clone)) throw new Error("no clone");
    // …and a directory that is not the top of its OWN repository is not a
    // clone: git would answer for whatever repository encloses it, and a
    // restore would then put back somebody else's files.
    const real = (d) => realpathSync.native(resolve(d)).toLowerCase();
    if (real(git(clone, "rev-parse", "--show-toplevel")) !== real(clone))
      throw new Error("not a clone's top");
    recorded = git(clone, "rev-parse", "HEAD");
    before = new Set(changedPaths(clone));
  } catch { return fn(); }
  const undo = () => {
    abortRebase(clone);
    const head = git(clone, "rev-parse", "HEAD");
    const committed = head !== recorded && !landed(clone, head)
      ? execFileSync("git", ["-C", clone, "diff", "--name-only", "-z", "--no-renames", recorded, head], { encoding: "utf8" }).split("\0").filter(Boolean)
      : [];
    const made = changedPaths(clone).filter((p) => !before.has(p));
    restore(clone, recorded, [...new Set([...committed, ...made])]);
  };
  const settle = (out) => { if (out?.error) undo(); return out; };
  let out;
  try { out = fn(); } catch (e) { undo(); throw e; }
  if (out && typeof out.then === "function")
    return out.then(settle, (e) => { undo(); throw e; });
  return settle(out);
}

// The pen's commit ceremony, shared by every write that lands a file on the
// town clone (letters and body edits alike): stage the paths, commit as the
// office bot (author string stable), return the sha, push when TOWN_PUSH=1.
// One ceremony so the two write spines can never drift in author or push rule.
//
// WHOLE OR NOTHING OVER ITS OWN PATHS (POS-296). Any throw from here — a push
// that cannot land, or git refusing to stage or commit — first puts `addPaths`
// back as they stood at HEAD and unmakes the unlanded commit, so every caller,
// in a transaction or not, is left with nothing when it is told no. A push that
// cannot land throws `notLandedError` (code 503, `pen: NOT_LANDED`); before
// POS-296 the commit stayed local and the next write's push carried it.
export function penCommit(clone, addPaths, message) {
  const base = git(clone, "rev-parse", "HEAD");
  try { return commitAndLand(clone, addPaths, message); }
  catch (e) { restore(clone, base, addPaths.map((p) => relTo(clone, p))); throw e; }
}

function commitAndLand(clone, addPaths, message) {
  const name = process.env.BOT_NAME ?? "postmark-office[bot]";
  const email = process.env.BOT_EMAIL ?? "office@postmark.invalid";
  for (const p of addPaths) git(clone, "add", p);
  // a save that changes nothing is a no-op, not a trip: nothing staged means
  // nothing to commit (git would exit 1 and read as an office error)
  if (!git(clone, "status", "--porcelain", "--", ...addPaths)) return null;
  git(clone, "-c", `user.name=${name}`, "-c", `user.email=${email}`,
      "commit", "-q", "-m", message, "--author", `${name} <${email}>`);
  let commit = git(clone, "rev-parse", "HEAD");
  if (process.env.TOWN_PUSH === "1") {
    // THE PUSH IS NOT THE RECEIPT — THE REMOTE TIP IS. On 2026-08-26 a fund
    // receipt's push lost a race with the town's own mail traffic, and this
    // line's bare `push -q` left the signed row LOCAL-ONLY for 100 minutes
    // while the exec had already answered success; every rehydrate tick then
    // failed to fast-forward until a hand rebased it. So: push, FETCH, and
    // require the commit to be an ancestor of origin/main before returning.
    // On a lost race, rebase onto the fresh tip and try again — every pen
    // commit is an append to town files, which is what makes the rebase safe.
    for (let attempt = 1; ; attempt++) {
      try { git(clone, "push", "-q"); } catch { /* verified below, not here */ }
      git(clone, "fetch", "-q", "origin", "main");
      try {
        git(clone, "merge-base", "--is-ancestor", commit, "origin/main");
        break; // landed — the only exit that returns
      } catch { /* not on the remote yet */ }
      if (attempt >= 3) throw notLandedError(`${commit} is not on origin/main after ${attempt} attempts, so the ceremony unmade it rather than call a local-only write success`);
      git(clone, "rebase", "-q", "origin/main");
      commit = git(clone, "rev-parse", "HEAD");
    }
  }
  return commit;
}

// vote-by-mail's frontmatter block. The trio is all-or-none: none given → "" (the
// letter is an ordinary letter, byte-identical to before); all three given → a
// shape-validated three-line block to append after `thread:`. Shape only — an open
// ballot, the exact candidate, and household headroom are the crossing's law, not
// the door's; we just refuse a malformed intent (named-field bounce, door manners).
// The stamp count is written as a bare integer; the ballot engine coerces it.
function buildStakeFm({ stake_topic, stake_candidate, stake_stamps }, bounce) {
  const present = (v) => v !== undefined && v !== null && v !== "";
  const given = [stake_topic, stake_candidate, stake_stamps].filter(present).length;
  if (given === 0) return "";
  if (given < 3)
    throw bounce(422, "incomplete stake",
      "vote-by-mail is all-or-none: set stake_topic, stake_candidate, and stake_stamps together, or leave all three off");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(stake_topic)))
    throw bounce(422, `stake_topic "${stake_topic}" is not a ballot slug`, "lowercase-hyphenated, exactly as the ballot lists the topic");
  const candidate = String(stake_candidate).trim();
  if (!candidate || candidate.includes("\n"))
    throw bounce(422, "stake_candidate must be a name", "one line; the exact candidate spelling the ballot lists");
  const n = Number(stake_stamps);
  if (!Number.isInteger(n) || n <= 0)
    throw bounce(422, `stake_stamps "${stake_stamps}" is not a positive whole number`, "stake a positive integer count of stamps");
  return `stake_topic: ${stake_topic}\nstake_candidate: ${candidate}\nstake_stamps: ${n}\n`;
}

// THE VALIDATION HALF, split out for a second caller (wave 3, POS-44).
//
// Flag-on, send_letter writes a town-log row instead of a file, and the row
// must still be judged at the door — a malformed letter that bounces twelve
// hours later at the crossing is the exact failure the whole slow-mail lane is
// supposed to cost nobody. So the checks below became a function the DOOR can
// run without writing anything, and enqueueLetter became its first caller
// rather than its owner.
//
// Nothing about the order or the bounces changed in the split, and that is
// load-bearing: flag-off, enqueueLetter runs these checks in this sequence and
// throws these codes, exactly as it did when they were inline.
//
// Returns the letter's computed identity — the fields the write half needs and
// the row needs alike, so neither recomputes a slug the other invented. Pure
// data: the plan travels to the town log and into the envelope pre-flight, and
// a callable riding inside it would be a thing those callers could mistake for
// part of the letter.
export function validateLetter({ from, to, title, thread, body, stake_topic, stake_candidate, stake_stamps }, key, db, acceptedIdentity = null) {
  // envelope checks — the ferry's rules, applied at the door
  if (!from || !to || !title || !body)
    throw bounce(422, "incomplete envelope", "required: from, to, title, body");
  // `thread:` is optional and defaults to `new`, exactly as the crossing does
  // (tools/envelope.mjs, 2026-07-27). Both doors default rather than infer, and
  // they default the SAME way: the whole point of the change is that the office
  // never rejects a letter the ferry would have accepted.
  thread ||= "new";
  if (!key.handles.has(from))
    throw bounce(403, `"${from}" is not one of your residents`, `this key acts for: ${[...key.handles].join(", ")}`);
  if (!db.prepare("SELECT 1 FROM residents WHERE handle = ?").get(to))
    throw bounce(422, `no resident "${to}"`, "handles are lowercase-hyphenated, as in WHITE_PAGES/");
  if (thread !== "new" && !db.prepare("SELECT 1 FROM letters WHERE id = ?").get(thread))
    throw bounce(422, `thread "${thread}" names no known letter`, 'use "new" or an existing letter id');
  if (Buffer.byteLength(body, "utf8") > MAX_BODY)
    throw bounce(413, "letter exceeds the size courtesy", `keep the body under ${MAX_BODY / 1000}KB; big artifacts belong in PROJECTS`);

  // vote-by-mail: an optional stake trio the letter carries into its frontmatter,
  // applied at the crossing by the ballot-pass (which owns the deep validation —
  // open ballot? household headroom? — and mints the receipt). Here we only prove
  // the intent is well-formed and all-or-none, so a chat/desk sender can stake by
  // writing a letter. A letter without these fields is byte-for-byte unchanged.
  const stakeFm = buildStakeFm({ stake_topic, stake_candidate, stake_stamps }, bounce);

  const slug = slugify(title);
  const derivedDate = letterDate();
  let date = derivedDate;
  let id = `${from}-${date}-to-${to}-${slug}`;

  // A drain replay is not a new send. The town-log row already carries the
  // identity the send door accepted, and wall time may have crossed the
  // town's midnight before the ferry materialises it (#2678). Preserve that
  // accepted identity, but validate it against the envelope before using it
  // as a path so a journal row can never smuggle an arbitrary filename in.
  if (acceptedIdentity?.id || acceptedIdentity?.file) {
    const storedId = String(acceptedIdentity?.id ?? "");
    const storedFile = String(acceptedIdentity?.file ?? "");
    const prefix = `WHITE_PAGES/${from}/outbox/letter-`;
    const suffix = `-to-${to}-${slug}.md`;
    const candidateDate = storedFile.startsWith(prefix) && storedFile.endsWith(suffix)
      ? storedFile.slice(prefix.length, storedFile.length - suffix.length)
      : "";
    const expectedId = `${from}-${candidateDate}-to-${to}-${slug}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(candidateDate)
        || storedId !== expectedId
        || storedFile !== outboxRelPath(from, candidateDate, to, slug)) {
      throw bounce(500, "stored letter identity is inconsistent with its accepted envelope",
        "the town-log row's id and file must name the same sender, date, recipient, and title slug; do not re-derive or guess a replacement identity");
    }
    date = candidateDate;
    id = storedId;
  }

  if (db.prepare("SELECT 1 FROM letters WHERE id = ?").get(id))
    throw bounce(409, "a letter with this id already exists today", "change the title, or write tomorrow — one slug per correspondent per day");

  return { id, from, to, date, thread, slug, stakeFm, body };
}

// The relative path a letter lands at in the sender's outbox. Exported because
// the town log's row discloses where the letter WILL stand, and a second
// spelling of this path is a second thing that can drift from the pen's.
export const outboxRelPath = (from, date, to, slug) =>
  `WHITE_PAGES/${from}/outbox/letter-${date}-to-${to}-${slug}.md`;

/**
 * THE DAY A LETTER IS DATED — the one derivation, so a caller can ask for it.
 *
 * Letters are human-day surfaces: dated in the town's local day, not UTC (the
 * env-clock-ahead class — an evening letter must not carry tomorrow's date).
 *
 * Extracted 2026-09-05 because it was computed inline in `validateLetter` and
 * nothing else could ask what it would answer. That is not a tidiness point: a
 * letter's date is in its id AND in `outboxRelPath`, so anything that needs to
 * predict where a letter will land had to re-spell this expression, and
 * `town-bridge.test.mjs § seedLetter` did the next worst thing — it pinned a
 * literal, `2026-08-24`. The row it seeded therefore disclosed an AUGUST path
 * while the door wrote today's file, the drain's resume check looked for the
 * August one and missed, and the letter was replayed into a 409 instead of
 * being recognised as `already`. Green on the day it was written, red every day
 * after. The S58 class, one file over.
 *
 * `enqueueLetter`'s own comment names the rule this restores: the file is
 * written "at the path outboxRelPath spells, because the row the door writes
 * discloses that same path to the sender, and two spellings of it would be two
 * things that can drift." A pinned date in a fixture is a third spelling.
 */
export const letterDate = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: process.env.TOWN_TZ ?? "America/New_York" }).format(new Date());

// Validate + write + commit. Returns { letter_id, commit, expected_crossing }
// or throws { code, defect, hint } in the bounce vocabulary.
export function enqueueLetter(args, key, db, clone, acceptedIdentity = null) {
  const { id, from, to, date, thread, slug, stakeFm, body } = validateLetter(args, key, db, acceptedIdentity);
  const relFile = acceptedIdentity?.file ?? outboxRelPath(from, date, to, slug);

  // freshen the clone, then write the letter file — at the path outboxRelPath
  // spells, because the row the door writes discloses that same path to the
  // sender, and two spellings of it would be two things that can drift. Whole
  // or nothing (POS-296): a letter that is refused leaves no file behind, so a
  // re-send is not bounced 409 by the corpse of the first try.
  const commit = penTransaction(clone, () => {
    if (process.env.TOWN_PUSH === "1") git(clone, "pull", "--rebase", "-q");
    const file = join(clone, relFile);
    const outbox = dirname(file);
    if (existsSync(file)) throw bounce(409, "that letter file already exists", "change the title");
    if (!existsSync(outbox)) mkdirSync(outbox, { recursive: true });

    const fm = `---\nid: ${id}\nfrom: ${from}\nto: ${to}\ndate: ${date}\nthread: ${thread}\n${stakeFm}---\n\n`;
    writeFileSync(file, fm + body.trim() + "\n");

    return penCommit(clone, [file],
      `${from} -> ${to}: ${slug} (via postmark-office, key household ${key.household})`);
  });

  // `expected_crossing` stays — frozen consumers read it (thread-is-the-letter-id
  // pins the key) — and `next_crossing` rides beside it with the number, the
  // minutes and the sentence a writer asked for (#2922). The two name one boat.
  return { letter_id: id, commit, expected_crossing: nextCrossing(), next_crossing: nextCrossingForReceipt(), pushed: process.env.TOWN_PUSH === "1" };
}
