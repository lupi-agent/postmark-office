// leave-exec.mjs — one world mark, atomically, under the caller's flock.
//
// Invoked by world.mjs (leaveMarkViaOffice) as a subprocess (on the box: wrapped
// in `flock -w 30 town.lock` — a mark write can never race a crossing or another
// write). Does the whole critical section in one process against the WORLD clone
// (postmark-world), which is separate from the town clone: pull, write the mark
// at its filing (its frozen path if the manifest names it, else its id — the
// freeze, 2026-08-25; the Settlement no longer re-homes anything),
// select/lazy-create draft/<household>, write the mark.md into that branch's
// tree, commit the record only, and push best-effort (a 403 is logged once and
// reported push-pending, never thrown). Prints one JSON line.
//
// A DRAFT COSTS NOTHING (Keemin-ruled 2026-08-22, the ship after the fold
// outage): no geometry placement, no lint gate, no fold gate at this door.
// Drafts go where the author says; the Settlement is where the world does its
// real work — lint, fold, containment, standing, consent — and adjudicates
// backwards-ratifiably. The gates this door used to run cost a full fold
// (~seconds, O(m²)) per write and took the world down on 2026-08-21.
//
// Env: WORLD_CLONE, TOWN_PUSH=1 to push, BOT_NAME/BOT_EMAIL (penCommit's).
// argv[2]: JSON { slug, kind, at, extent, points?, body, tier, slot?, value?,
//                 parent_id?, by, household, date } — identity/date derived.
//
// Exit 0 with { id, dir, parent, branch, commit, pushed, push_error? } or
// { error: { code, defect, hint } } (a bounce is an answer); exit 1 only when the
// machinery itself trips.

import { onePerResidentDefect, onePerResidentHint, capHint, residentParcels, isPriorEstate } from "./parcel-law.mjs";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { penCommit } from "./write.mjs";
import { markRecord } from "./mark-record.mjs";
import { ensureDraftCheckout } from "./world-branches.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// WORLD_CLONE is the LEASED WORKTREE when the pool is on (tier 1) and the shared
// clone otherwise — same directory shape either way, so everything below reads
// the same. WORLD_POOL_SLOT is the parent's signal that this is a lease: seat
// with the pooled ceremony, and leave the push to the parent, which does it
// after the locks are released.
const CLONE = process.env.WORLD_CLONE ?? resolve(HERE, "..", "world-clone");
const SLOT = process.env.WORLD_POOL_SLOT ?? null;
const SHARED = process.env.WORLD_SHARED_CLONE ?? null;
const MARKS_DIR = join(CLONE, "WORLD", "marks");
const ROOT_DIR = join(MARKS_DIR, "let-there-be-light");

// THE FOSSIL MANIFEST (the freeze, founder-ruled 2026-08-25). `filing-freeze.json`
// maps every mark alive on the freeze date to the path it was filed at, keyed by
// full id, minted once and never regenerated. It is the exact answer to "where
// does this mark already live", and the only marks it does not name are the ones
// born after the freeze — which file at their id.
let _frozenDirs;
const frozenDirOf = (id) => {
  if (_frozenDirs === undefined) {
    try {
      const raw = JSON.parse(readFileSync(join(CLONE, "WORLD", "filing-freeze.json"), "utf8"));
      _frozenDirs = new Map(Object.entries(raw?.marks ?? {}));
    } catch { _frozenDirs = null; }   // no manifest → a tree that declares no freeze
  }
  const rel = _frozenDirs?.get(String(id));
  return rel ? join(CLONE, ...String(rel).split("/")) : null;
};

const answer = (obj) => { console.log(JSON.stringify(obj)); process.exit(0); };
const err = (code, defect, hint) => answer({ error: { code, defect, hint } });

// phase stamps for the one [timing] stderr line printed on the success path —
// the write-path decomposition (lock wait lives in the parent's total).
const T0 = performance.now();
const phases = [];
const timed = (name, fn) => { const t = performance.now(); const r = fn(); phases.push(`${name}=${Math.round(performance.now() - t)}ms`); return r; };

async function main() {
  const p = JSON.parse(process.argv[2] ?? "{}");
  if (!existsSync(ROOT_DIR)) return err(409, "not-yet-open", "the office has no world clone with a marks tree");
  if (!p.household) return err(403, "this credential has no resident household", "sign in as a resident household before leaving a mark");
  // The door refuses the word (B, ruled 2026-08-12; applied 2026-08-13): tier
  // is not a field — standing is derived by the one walk over the ground, never
  // asserted by the author. This door used to pass the field through to disk;
  // the residue that habit left has been stripped, and the world's own gate now
  // bounces a carrier, so refusing here is the same law one door earlier.
  if (p.tier !== undefined) return err(422, "tier: is not a field", "standing is derived from the ground your mark stands on — drop the tier field and the walk will answer it");

  const tools = join(CLONE, "tools");
  const tEngine = performance.now();
  const foldMod = await import(pathToFileURL(join(tools, "marks-fold.mjs")));
  const { loadMarks, containmentParents, containmentParentOf, placementParent, worldRootOf,
          PARCEL_CLAIM_CAP, PARCEL_CAP_LAW_DATE, PARCEL_EXTENT_M,
          worldToFile, ringToFile, COORDS_FIELD, COORDS_RELATIVE } = foldMod;
  phases.push(`engine=${Math.round(performance.now() - tEngine)}ms`);
  let branch;
  try {
    branch = timed("checkout", () => ensureDraftCheckout(CLONE, p.household, { pooled: !!SLOT, shared: SHARED }));
  } catch (e) {
    return err(409, "the household sketchbook is not ready", String(e?.message ?? e).slice(0, 300));
  }

  const marks = timed("load", () => loadMarks(MARKS_DIR));
  const byId = new Map(marks.map((m) => [m.id, m]));
  const id = `${p.by}/${p.slug}`;

  // helpers the revision family shares (founder-ruled 2026-08-19, edit-law's
  // second family finally at the door): does anything stand on this mark, and
  // does published main hold this path.

  // ── WHAT STANDS ON THIS MARK (re-keyed by the freeze, 2026-08-25) ─────────
  //
  //   "A mark's directory is its historical filing: it carries no claim."
  //
  // This used to read the mark's CHILD DIRECTORIES. Under filing by identity a
  // mark's children are not underneath it on disk, so the directory read returns
  // false forever and BOTH guards below — the withdraw guard at the `withdraw`
  // arm and the amend-move guard — silently stop protecting. Nothing errors; the
  // stranding just happens.
  //
  // Asked of the ground instead, through the world's own fold. Two edges count,
  // because both can be stranded: CONTAINMENT (what stands geometrically inside
  // it, `containmentParents` — the same derivation the settlement folds) and
  // PREDICATION (what describes it, the authored nesting edge the freeze leaves
  // alone). This mirrors the store-side read the journal door already performs
  // in world.mjs's `journalWithdraw`, which counts live children and canon's.
  //
  // A fold too old to export `containmentParents` falls back to the directory
  // read rather than to no guard at all: a stale guard beats an absent one, and
  // the old behaviour is exactly what a pre-freeze tree wants.
  const containedBy = typeof containmentParents === "function"
    ? containmentParents(marks).parent : null;
  const holdsChildren = (d, markId = null) => {
    if (containedBy && markId) {
      for (const [child, parent] of containedBy) if (parent === markId && child !== markId) return true;
      return marks.some((m) => m._parentMarkId === markId);
    }
    return readdirSync(d, { withFileTypes: true })
      .some((e) => e.isDirectory() && existsSync(join(d, e.name, "mark.md")));
  };
  const onMain = (absFile) => {
    try { execFileSync("git", ["-C", CLONE, "cat-file", "-e", `main:${relative(CLONE, absFile).replace(/\\/g, "/")}`]); return true; }
    catch { return false; }
  };

  // ── WITHDRAW — the terminal supersession (edit-law § withdraw) ────────────
  // The node leaves the draft now and canon at the next crossing; its whole
  // life stays in the log. Guards: your own hand only (the door enforced by),
  // no children (orphan re-homing is the crossing's arithmetic, not built for
  // withdrawals yet), escrow zero (the door checked the ledger before us).
  if (p.op === "withdraw") {
    const rec = byId.get(id);
    if (!rec) return err(404, `no mark "${id}" in your world`, "ids are <by>/<slug> — you can withdraw your drafts and your published marks; check world_my_marks");
    const dir0 = rec._dir;
    if (holdsChildren(dir0, id)) return err(409, `"${id}" still holds marks inside it`,
      "withdraw or move the children first — a withdrawal may not strand what stands on it");
    const oldFile = join(dir0, "mark.md");
    const oldRecord = readFileSync(oldFile, "utf8");
    const relPath = relative(CLONE, oldFile).replace(/\\/g, "/");
    const wasPublished = onMain(oldFile);
    rmSync(dir0, { recursive: true, force: true });
    // No lint/fold gate — a draft costs nothing (header note, 2026-08-22); the
    // Settlement adjudicates. oldRecord is kept in the log by the commit itself.
    const pushReqW = process.env.TOWN_PUSH === "1" && !SLOT;
    const savedW = process.env.TOWN_PUSH;
    delete process.env.TOWN_PUSH;
    let commitW;
    try { commitW = timed("commit", () => penCommit(CLONE, [relPath], `withdraw: ${id} — by ${p.by} (via world_withdraw_mark)`)); }
    finally { if (savedW !== undefined) process.env.TOWN_PUSH = savedW; }
    let pushedW = false, pushErrW;
    if (pushReqW && commitW) {
      try { timed("push", () => execFileSync("git", ["-C", CLONE, "push", "-q", "--set-upstream", "origin", branch], { encoding: "utf8" })); pushedW = true; }
      catch (e) { pushErrW = String(e.stderr ?? e.message ?? e).split("\n").find(Boolean)?.slice(0, 160); }
    }
    return answer({ id, withdrawn: true, was_published: wasPublished,
      effect: wasPublished
        ? "your sketchbook lets it go now; canon lets it go at the next crossing — the settlement unpublishes it, and its whole life stays in the log"
        : "the draft is gone — it never crossed, so there is nothing to unpublish; its life stays in the log",
      branch, commit: commitW, pushed: pushedW, push_error: pushErrW });
  }

  // ── AMEND — a newer declaration on your own node (edit-law § amend) ────────
  // Same-slug leave-mark with amend: true supersedes in place: one copy, ever —
  // the sketchbook must never hold a mark at two paths (#1862's disease).
  const amending = byId.has(id) && p.amend === true;
  if (byId.has(id) && !amending)
    return err(409, `you already have a mark "${p.slug}"`,
      "a slug is unique per author — pass amend: true to supersede it (a newer declaration on your own node, edit-law's revision family), or pick another slug");
  const priorRec = amending ? byId.get(id) : null;

  // The parcel-claim cap (Keemin's ruling 2026-07-30): a credential household —
  // handles grouped by WORLD/households.json, the town-pin registry — may claim
  // at most 3 parcels; holdings predating the law stand as prior estate. The
  // fold enforces this too (marks-fold § admissibility); bouncing here gives
  // the resident the honest sentence before anything is written.
  if (p.kind === "parcel") {
    // The dial, not a declaration: every parcel is the town's square (Keemin,
    // 2026-07-31). The door already bounced any passed extent; this writes the
    // law regardless of what reaches the writer. ?? 25 rides out a box clone
    // that has not yet pulled the constant.
    const side = PARCEL_EXTENT_M ?? 25;
    p.extent = { w: side, h: side };
    // THE CAP ASKS ONLY OF NEW GROUND (2026-09-15, Linear POS-88; the instance:
    // Current re-amending the-keepers-flat, held since S45, bounced "already
    // holds 4 parcels"). `amending` was computed above and never consulted here,
    // so `held` counted the very parcel being amended and an amendment of a
    // holding read as a claim for new ground. The law's own sentence below says
    // prior holdings stand; an amendment of one is not a claim. The extent dial
    // above still applies to every parcel act — every parcel is the town's square.
    if (!amending) {
      const cap = PARCEL_CLAIM_CAP ?? 3;
      let registry = null;
      try { registry = JSON.parse(readFileSync(join(CLONE, "WORLD", "households.json"), "utf8")).households ?? null; } catch { /* no registry → solo grain */ }
      const credOf = (handle) => registry?.[handle] ?? `solo:${handle}`;
      const cred = credOf(p.by);
      const held = marks.filter((m) => m.kind === "parcel" && credOf(m.by ?? m.household) === cred).length;
      if (held >= cap)
        return err(403, `your household already holds ${held} parcel${held === 1 ? "" : "s"}`,
          capHint(cap, PARCEL_CAP_LAW_DATE ?? "2026-07-30"));
      // one parcel per resident (the-town/one-per-resident, Darko 2026-10-04; POS-368)
      const theirs = residentParcels(marks, p.by, id);
      if (theirs.length && !isPriorEstate(foldMod, id))
        return err(409, onePerResidentDefect(foldMod), onePerResidentHint(theirs[0].id));
    }
  }

  // decide the directory. sited/parcel file BY IDENTITY — `WORLD/marks/<by>/
  // <slug>/` (the freeze, founder-ruled 2026-08-25; LOGOS/state-and-time.md:
  // "New marks are filed by identity"). They used to land on open ground at the
  // ROOT on the reasoning that "the Settlement's own sweep re-homes every draft
  // by geometry at the save regardless of where the file sits" — the freeze
  // DELETED that mover, so where this door files is where the mark lives.
  // predicated/naming take the directory of the mark they describe (parent_id).
  //
  // ⚠ THIS DOOR IS CONDEMNED. It is the git-era write path, superseded by the
  // journal door (world-journal.mjs `pathFor`), and it dies with the sweep-era
  // deletion. This is the one-line minimum that keeps it from writing a filing
  // the world's own gate B would refuse; nothing else here was brought forward.
  let parentDir, parentId, fossilDir = null;
  if (p.kind === "sited" || p.kind === "parcel") {
    parentId = null;
    // GATE A BEFORE GATE B. A mark's path is wherever it was born, forever: if
    // this id is in the frozen manifest, its filing is the manifest's and this
    // door must not compute a new one — gate A refuses a move at the next lint.
    // Only a mark the manifest does not name files at its id. The manifest is
    // read from the clone's own tree; absent, every mark is a new mark, which is
    // the right reading for a tree that declares no freeze.
    fossilDir = frozenDirOf(id);
    parentDir = fossilDir ? dirname(fossilDir) : join(MARKS_DIR, p.by);
  } else {
    parentId = p.parent_id;
    const parent = byId.get(parentId);
    if (!parent) return err(422, `no mark "${parentId}" to describe`, "predicated/naming marks nest under the mark they describe — pass its id as parent_id");
    if (parent.kind !== "sited" && parent.kind !== "parcel") return err(422, `"${parentId}" cannot hold a description`, "only sited/parcel marks carry predicated/naming children");
    parentDir = parent._dir;
  }

  // The fossil's own directory, verbatim — never recomposed from parent+slug,
  // because the manifest names the whole path and a fossil slug need not equal
  // its leaf directory for the join to be safe.
  const dir = fossilDir ?? join(parentDir, p.slug);

  // The amend's move law: in place (same computed directory) is always fine;
  // a MOVE is fine for a draft-only mark, refused when the mark holds children
  // (nothing may be stranded) and refused for a published mark until the
  // publish+re-home seam (#1862) is fixed — a moved copy of a main path is
  // exactly that wedge's shape.
  let oldDir = null, oldFile = null, oldRecord = null, amendMoves = false;
  if (amending) {
    oldDir = priorRec._dir;
    oldFile = join(oldDir, "mark.md");
    oldRecord = readFileSync(oldFile, "utf8");
    amendMoves = resolve(dir) !== resolve(oldDir);
    if (amendMoves) {
      if (holdsChildren(oldDir, id)) return err(409, "an amend that would move a mark holding others",
        "marks stand inside this one — keep at/extent so it stays on its ground, or move the children first");
      if (onMain(oldFile)) return err(409, "a published mark cannot MOVE by amend yet",
        "the publish+re-home seam (#1862) is unfixed — amend in place (same ground), or withdraw and leave it anew");
    }
  }
  if (existsSync(dir) && !(amending && !amendMoves))
    return err(409, "a mark already sits in that spot", `the directory ${relative(MARKS_DIR, dir)} exists — pick another slug`);

  // sovereignty guard — REPEALED for sited marks (Keemin-ruled 2026-08-17,
  // party night; little-bird's cup was the test case), and now GONE for parcels
  // too (postmark#3025, 2026-09-20). It read the July atlas painting
  // `seeding/manifest.json` and refused a parcel contained by another
  // household's painted house. Measured over the live fold before deletion: of
  // the 74 painted houses still in the record, only four can contain a 25 m
  // dial and all four ARE parcels, which `tools/marks-fold.mjs § admissibility`
  // already refuses by overlap — the wider test. No sited painted house is as
  // large as the dial, so this could not fire on a house at all.
  //
  // DELETED HERE IN THE SAME COMMIT as its twin in `world.mjs`'s leave-mark, so
  // the two holders of this door cannot disagree about it — the #2888
  // split-brain shape, where one law lived in one executor for a month and the
  // sibling's falsifiers stayed green over the gap.

  // SCHEMA v3, feature-detected: in a relative tree a nested record's at:/points:
  // are offsets from the PARENT'S CENTRE. The resident speaks world coordinates
  // at the door; the FILE speaks the frame — the same conversion the migrator
  // used, from the clone's own fold. Root-level marks are framed on the origin,
  // so their numbers do not change; an old clone (no worldToFile) keeps v2
  // behavior byte-for-byte.
  //
  // WHAT THE GATE DOES AND DOES NOT REFUSE. This comment used to end "if this
  // conversion is ever wrong, the lint+fold gate below refuses the write — the
  // door cannot land a misplaced record". There IS no gate below: a draft costs
  // nothing (header, 2026-08-22), and the lint and the fold run at the
  // Settlement, not here. What they judge is whether a record PARSES and whether
  // its composed footprint is admissible — overlap, standing, consent. A number
  // written in the wrong frame parses, and it composes to a real point on the
  // ground, so it is admissible: the gate reads a mark that has MOVED, not a
  // mark that is misplaced, and it has no way to tell the two apart. Nothing
  // downstream refuses this; getting the origin right here is the whole guard.
  // It did not, twice — `vermillion/the-pando-peak` (2026-08-27, fixed at the
  // drain) and `current-the-reader/the-snug-mooring` (2026-09-14, world
  // `3a3a645c`: the resident's correct absolute landed in a nested slot and the
  // fold read it as an offset, 5 km out to sea).
  //
  // THE ORIGIN, for a sited/parcel mark the frozen manifest already nests. Such
  // a mark carries no `parent_id` — geometry decides its containment — so the
  // `parentId` test below is false for it and the conversion was skipped
  // entirely: the resident's ABSOLUTE went into a relative slot verbatim. A
  // FRESH sited leave files at `WORLD/marks/<by>/<slug>/`, which is root level,
  // where absolute IS the file frame and nothing needs shifting; the hole is
  // only the amend of a fossil, whose filing is nested. Its origin is the
  // composed centre of the mark that FRAMES it — the same anchor
  // `world-journal.mjs § pathFor` takes ("the innermost containing mark is the
  // anchor") and the same one `world-drain.mjs § fileFramer` already takes.
  //
  // Read from the fold's own answer for that record (`_origin`), not
  // re-derived from the directory: the frame is the nearest positioned ancestor
  // THAT BINDS the record (marks-fold § the tier binding), which steps past an
  // ancestor the record outranks. Measured on world `58d4722e`, 7 of the 385
  // frozen nested sited marks are framed on a mark that is NOT their directory
  // parent, so a directory-parent centre would file those 7 against a frame the
  // fold does not use — the same defect in a new place. The fossil the manifest
  // names but the tree no longer holds has no such record; it falls back to the
  // mark standing in `parentDir` (which IS `dirname(fossilDir)` by construction
  // above — one name, so the two cannot drift), and to the null origin when
  // nothing stands there.
  //
  // The door stays CONDEMNED. Nothing else about it changes.
  const rootRec = marks.find((m) => m.id === "the-town/let-there-be-light");
  const relativeTree = !!worldToFile && COORDS_FIELD &&
    String(rootRec?.[COORDS_FIELD] ?? "").trim() === COORDS_RELATIVE;
  const frameOrigin = () => {
    if (parentId) return byId.get(parentId)?.at ?? null;   // composed world centre — loadMarks composed it
    if (!fossilDir) return null;                           // root-level filing: absolute IS the file frame
    const fossilRec = byId.get(id);
    if (fossilRec?._origin) return fossilRec._origin;      // the fold's own frame for this very record
    const framing = marks.find((m) => m._dir && resolve(m._dir) === resolve(parentDir));
    return framing?.at ?? null;
  };
  const fileRec = { ...p };
  if (relativeTree) {
    const origin = frameOrigin();
    if (origin) {
      if (fileRec.at) fileRec.at = worldToFile(fileRec.at, origin);
      if (fileRec.points) fileRec.points = ringToFile(fileRec.points, origin);
    }
  }

  // build the record: path owns containment, everything else is a field. by/date
  // are server-derived; a sited/parcel mark never authors a parent (geometry decides).
  // class/ask/reward/status: the bounty grammar (founder-ruled 2026-08-11) — the
  // door validated them; here they only need to reach the record, or the board's
  // reader can never see a resident's notice.
  // image: the media pointer (2026-08-15) — the door validated the URL's
  // host; here it only needs to reach the record, or investigate can never
  // return it and the site can never render it.
  // The grammar moved to src/mark-record.mjs when the drain became its second
  // writer (POS-5 slice 2). Same bytes, one home — two copies of a
  // serialization is how two eras come to disagree about the same declaration
  // in a way that still parses.
  const record = markRecord(fileRec, p.body);

  // ── PREVIEW (founder-ruled 2026-09-14, postmark#2692): every guard above has
  // run and the record is composed; a preview answers where it would nest, by
  // the engine's own containment rule over the sketchbook's marks plus the
  // candidate, and writes nothing — no file, no commit, no push.
  if (p.preview === true) {
    const candidate = { id, kind: p.kind, by: p.by, at: p.at ?? null, extent: p.extent ?? null, ...(p.points ? { points: p.points } : {}) };
    const all = [...marks.filter((m) => m.id !== id), candidate];
    const parent = typeof containmentParentOf === "function" ? (containmentParentOf(candidate, all) ?? null)
      : typeof placementParent === "function" ? (placementParent(candidate, all) ?? worldRootOf?.(all)?.id ?? null)
      : null;
    return answer({ preview: true, id, kind: p.kind, parent, would: amending ? "amend" : "leave",
      dir: relative(MARKS_DIR, dir).replace(/\\/g, "/"), at: p.at ?? null, extent: p.extent ?? null, branch,
      ...(amending ? { amended: true, moved: amendMoves } : {}),
      nothing_written: "a preview: no file, no commit, no push — leave the mark without preview: true to write it" });
  }

  if (amending && amendMoves) rmSync(oldDir, { recursive: true, force: true }); // one copy, ever
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "mark.md"), record);

  // No lint gate, no fold gate — a draft costs nothing (header note,
  // 2026-08-22). The record is written exactly as declared; the Settlement's
  // lint + fold judge it at the save and bounce/re-home there.

  // Commit the draft record only, then push the household branch best-effort.
  // Derived files stay on main so a private draft never masquerades as canon.
  // An amend-with-move also stages the OLD path, so the commit records the
  // supersession as one act: deletion and new declaration together.
  const addPaths = [join(dir, "mark.md")];
  if (amending && amendMoves) addPaths.push(relative(CLONE, oldFile).replace(/\\/g, "/"));
  // A pooled write's push belongs to the parent, AFTER it drops the town lock
  // and the worktree lease: a network round-trip is the one part of this that
  // has no business inside a critical section. The reported fields are the same
  // either way — the parent fills in pushed/push_error before answering.
  const pushRequested = process.env.TOWN_PUSH === "1" && !SLOT;
  const savedPush = process.env.TOWN_PUSH;
  delete process.env.TOWN_PUSH; // penCommit's push throws; this door degrades to push-pending
  let commit;
  try {
    commit = timed("commit", () => penCommit(CLONE, addPaths,
      amending ? `amend: ${id} — by ${p.by} (via world_leave_mark, supersedes in place)` : `mark: ${id} — by ${p.by} (via world_leave_mark)`));
  } finally {
    if (savedPush !== undefined) process.env.TOWN_PUSH = savedPush;
  }

  let pushed = false, push_error;
  if (pushRequested && commit) {
    try { timed("push", () => execFileSync("git", ["-C", CLONE, "push", "-q", "--set-upstream", "origin", branch], { encoding: "utf8" })); pushed = true; }
    catch (e) { push_error = String(e.stderr ?? e.message ?? e).split("\n").find(Boolean)?.slice(0, 160); console.error(`[leave-exec] push pending for ${id}: ${push_error}`); }
  }

  console.error(`[timing] child=${Math.round(performance.now() - T0)}ms ${phases.join(" ")}`);
  // `at`/`extent` are the EFFECTIVE footprint, which is not always the one that
  // arrived: a parcel's extent is the town's dial, set here and never declared.
  // The door reads them back to tell an author where their claim actually landed
  // (issue #5 §1), and a resident reading the answer learns the same thing.
  answer({ id, dir: relative(MARKS_DIR, dir).replace(/\\/g, "/"), parent: parentId, kind: p.kind,
           at: p.at ?? null, extent: p.extent ?? null, branch, commit, pushed, push_error,
           ...(amending ? { amended: true, moved: amendMoves,
             superseded: "the prior declaration — every version stays in the log; canon shows the latest at the next crossing" } : {}) });
}

main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
