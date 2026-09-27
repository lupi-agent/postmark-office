#!/usr/bin/env node
// marks-ingest.mjs — THE WORLD REPO'S MARKS BECOME THE STORE'S ROWS, at a bless
// (POS-142, the class).
//
//   node world2/tools/marks-ingest.mjs --world-repo <clone> --ref <tag|sha|blessed>
//                                      [--since <ref>] [--dry-run]
//
//   env: PG* (the owner role — see § THE ROLE), exactly as backfill-register and
//        replay-ingest take it: `. world2-lib.sh && w2_pgenv world2_owner PG_WORLD2_OWNER_PASSWORD`
//
// EXIT: 0 ingested, or nothing to ingest (head already at the ref, or no bless)
//       · 1 REFUSED — a STOP named below, a failed statement, or a head that is
//         not an ancestor of the ref; nothing is written, the transaction rolls
//         back whole · 2 a bad argument or no store credential.
//
// ── THE FINDING THIS CLOSES ─────────────────────────────────────────────────
//
// PR #173 folds the World page from the store's rows. Against prod's store the
// rows fold differed from the published file by 7 marks no row held and ~50
// rows that were STALE — every one a file-side change after the 08-28 seed
// that the store never received (sweep publications of amended drafts,
// operator pre-acts, founder commits). Door-made writes reach the store through
// the clearing; nothing carried the world repo's own changes. `retire-unpublished`
// named the gap as its "DOOR B · A LAW OR HAND COMMIT ON MAIN … closing this
// door means the store learning to diff canon against its own register, which
// is a different lane". This is that lane.
//
// ── THE STORE'S AMENDMENT SHAPE, MEASURED — AND MIRRORED, NOT RE-INVENTED ───
//
// The brief pointed at the git pen (`src/leave-exec.mjs:179-190`, "supersedes
// in place: one copy, ever … every version stays in the log; canon shows the
// latest") and warned that "the append-only trigger refuses UPDATEs". Measured:
// the append-only trigger is `acts_append_only` (002_grants.sql) and guards
// `acts` alone. `marks` has ONE lawful write shape, `materialize.mjs`, and it is
// the git pen's sentence in rows:
//
//   ADD     a `locked` claim, then `materializeClaims` INSERTs the mark with the
//           claim's id.
//   AMEND   a NEW `locked` claim whose `supersedes` is the standing mark's id
//           (001: "amend-chain resolution"), then `materializeClaims` REWRITES
//           the row in place — `marks.slug` is UNIQUE, so one copy, ever — and
//           moves `locked_window` to the window that ruled this version. Every
//           version stays in the log: each is its own claim row.
//   RETIRE  `retireMarks` — `status = 'retired'`, `retired_window` — the shape
//           `retire-unpublished` writes when the sweep unpublishes a mark.
//
// That is DEC-17's admission path as `backfill-register.mjs § applyBackfill`
// already walks it for a file-side mark the store lacks. This tool calls the
// SAME `materializeClaims` and `retireMarks`: no fourth way of turning a claim
// into a mark. It differs from the backfill in exactly three places, each named:
// it stamps its own provenance (`_ingested_from`, not the backfill's
// `locked_by: founder`, which would be false here); it runs at every bless over
// the whole register rather than one class per ruling; and it gates amends and
// retires on a commit in the ingested range (§ THE RANGE GATE).
//
// ── WHAT IS COMPARED: THE RECORD THE FOLD READS ─────────────────────────────
//
// `replay-ingest`'s `SUBSTANCE_COLUMNS` leave out `data` and `parent`, which is
// how 30 images and 18 parents went stale with no gate red. So the diff here is
// in RECORD space: the store's row and the ref's derived row are both passed
// through `marksFromRows` (src/world2-fold.mjs — the function PR #173 proved is
// the loader's inverse) and compared key by key. Every key the loader carries
// counts, except the ones the store stamps and no file authors — the measured
// list in `src/mark-record.mjs § DERIVED`, imported rather than restated — and
// the parser's underscore internals, of which only `_parentMarkId` is a fact
// the fold reads (the continuation edge).
//
// ── THE RANGE GATE: AN AMEND OR A RETIRE NEEDS THE FILE TO HAVE MOVED ───────
//
// The store is allowed to be AHEAD of the blessed file: a mark a resident
// amended at the door is ruled at a window, and the sweep publishes it at a
// later crossing. A diff alone cannot tell "the store is stale" from "the file
// has not caught up", and writing the file's version over the second would
// revert a resident's act. So an amend or a retire is written only when:
//   · a commit in (base, ref] changed (or deleted) the mark's file — that commit
//     is the provenance the row records; and
//   · the store's row was ruled BEFORE that commit (`locked_window`'s close). A
//     row ruled after the file's last change is the door's later word.
// Anything else that differs is REPORTED under SKIPPED with its reason and left
// alone. An ADD reverts nothing and needs no gate; its provenance is the newest
// commit that touched its file.
//
// `base` is the store's `projection_heads['world-marks']` — the last ingested
// ref — or, before the first run, the genesis seed's world sha
// (`windows.receipts.seeded_from.world_sha`), or `--since`.
//
// ── A FACT THE ROW SHAPE CANNOT HOLD IS A STOP, NEVER A SHIM ────────────────
//
//   · a file-side mark whose slug the store holds RETIRED — `marks.slug` is
//     unique and no pen un-retires a row;
//   · a parent that is neither in the store nor in this ingest — `marks.parent`
//     is a non-deferrable FK;
//   · a head or base that is not an ancestor of the ref.
// A STOP refuses the whole run, dry or not, and names every instance.
//
// ── HELD BY NAME ────────────────────────────────────────────────────────────
//
// `backfill-register.mjs § REFUSED_BY_NAME` is honoured here by the same set,
// imported. The dry run and the run both print a held name under HELD. Lifting
// a hold is a ruling, and the set is the one place it is lifted. The set is
// EMPTY since 2026-09-24: Keemin ruled `wright/the-lit-name` in ("meant keep it
// in!"), and it now plans as any other mark does.
//
// ── THE DRY RUN READS THE STORE; IT CANNOT WRITE IT ─────────────────────────
//
// A diff against the store cannot be made without reading the store, so
// `--dry-run` connects — inside `BEGIN READ ONLY`, where Postgres itself refuses
// any write — derives the SAME plan the run would, prints it, and rolls back.
// One function plans both arms (the backfill's rehearsal lesson).
//
// ── THE ROLE ────────────────────────────────────────────────────────────────
//
// An ingest INSERTs claims and INSERTs/UPDATEs marks and writes its head.
// 002_grants gives those halves to different roles (office_api: claims;
// clearing_job: marks), so the one role that holds them all is the owner,
// `world2_owner` — what backfill-register and replay-ingest connect as. The
// write arm checks its grants before it writes and refuses by name.
//
// ── THE CHECKOUTS TOUCH NOTHING ─────────────────────────────────────────────
//
// The ref and the base are read through throwaway `git clone --shared
// --no-checkout` copies in the temp directory (the checkout PR #173's test
// uses). Nothing is written into the clone this is pointed at — no worktree
// registration, no checkout, no fetch — so the office's own world clone can be
// the argument while the tick holds its lock.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { deriveSeed, canonicalJson, uuid5 } from "./seed-import.mjs";
import { materializeClaims, retireMarks } from "./materialize.mjs";
import { REFUSED_BY_NAME } from "./backfill-register.mjs";
import { marksFromRows } from "../../src/world2-fold.mjs";
import { DERIVED } from "../../src/mark-record.mjs";
import { blessed } from "../../src/world-branches.mjs";

export const HEAD_KEY = "world-marks";      // projection_heads.repo — law-ingest's pattern, its own row
export const CAUSE = "marks-ingest";

// ── the record-space diff ────────────────────────────────────────────────────

/**
 * Keys a store row carries that no file authors. `mark-record.mjs § DERIVED`
 * measured them on the corpus (family 1: the store's stamps; family 2: the
 * door's transport keys). `slug`, `body` and `household` are in that list as
 * TRANSPORT keys of a door payload, but in a `marksFromRows` record they are
 * the record's own fields, set from columns — so they stay compared.
 */
const RECORD_FIELDS_FROM_COLUMNS = new Set(["slug", "body", "household"]);
export const STORE_STAMPS = new Set(DERIVED.filter((k) => !RECORD_FIELDS_FROM_COLUMNS.has(k)));

/** Is `k` a key the fold's record carries as a fact of the mark? */
export const isRecordField = (k, v) =>
  !STORE_STAMPS.has(k)
  && (!k.startsWith("_") || k === "_parentMarkId")
  // `source` as an OBJECT is the backfill's old stamp (mark-record.mjs § EMITS);
  // as a string it is the resident's word and counts.
  && !(k === "source" && v !== null && typeof v === "object");

/** The record fields on which two `marksFromRows` records differ, sorted. */
export function recordDiff(fileRec, storeRec) {
  const out = [];
  for (const k of new Set([...Object.keys(fileRec), ...Object.keys(storeRec)])) {
    const a = fileRec[k], b = storeRec[k];
    if (!isRecordField(k, a ?? b)) continue;
    if (a === undefined && b === undefined) continue;
    if (!isDeepStrictEqual(a ?? null, b ?? null) && canonicalJson(a ?? null) !== canonicalJson(b ?? null)) out.push(k);
  }
  return out.sort();
}

// ── the plan: ONE function, both arms ────────────────────────────────────────

/**
 * What the store must learn to say what the file says at `ref`. PURE.
 *
 * @param {object}   o
 * @param {object[]} o.derived     `deriveSeed` marks rows at the ref (class marks already excluded — LAW)
 * @param {object[]} o.storeRows   every `marks` row, with `locked_at` (the close of its locked_window)
 * @param {Map}      o.pathAtRef   slug -> repo path of its mark.md at the ref
 * @param {Map|null} o.pathAtBase  slug -> repo path at the base (null: no base, so no retire can be proven)
 * @param {Function} o.commitFor   ({ path, range, deleted }) -> { sha, author, at, subject } | null
 * @param {Set}      [o.held]      slugs held by name
 */
export function planIngest({ derived, storeRows, pathAtRef, pathAtBase = null, commitFor, held = REFUSED_BY_NAME }) {
  const standing = storeRows.filter((r) => r.status === "standing");
  const bySlug = new Map(storeRows.map((r) => [r.slug, r]));
  const fileRecs = new Map(marksFromRows(derived, []).map((m) => [m.id, m]));
  const storeRecs = new Map(marksFromRows(standing, []).map((m) => [m.id, m]));
  const derivedBySlug = new Map(derived.map((r) => [r.slug, r]));

  const adds = [], amends = [], retires = [], skipped = [], heldOut = [], stops = [];
  const ruledAfter = (row, commit) => row.locked_at && commit?.at && new Date(row.locked_at) > new Date(commit.at);

  for (const row of derived) {
    const slug = row.slug;
    const was = bySlug.get(slug);
    if (was && was.status !== "standing") {
      stops.push(`${slug}: the file carries it at this ref and the store holds it RETIRED (window ${was.retired_window ?? "?"}) — ` +
        "`marks.slug` is unique and no pen un-retires a row");
      continue;
    }
    const fields = was ? recordDiff(fileRecs.get(slug), storeRecs.get(slug)) : null;
    if (was && !fields.length) continue;                       // the store already says it
    if (held.has(slug)) { heldOut.push({ slug, why: "HELD by the founder's word — refused by name (backfill-register § REFUSED_BY_NAME)" }); continue; }
    const path = pathAtRef.get(slug);
    if (!was) {
      const commit = commitFor({ path, range: false, deleted: false });
      if (!commit) { stops.push(`${slug}: no commit on the ref's ancestry names its file ${path} — a row with no provenance is not an act`); continue; }
      adds.push({ slug, row, commit });
      continue;
    }
    const commit = commitFor({ path, range: true, deleted: false });
    if (!commit) { skipped.push({ slug, fields, why: "differs, but no commit since the head changed its file — not the file's change to carry (a door-made row the file has not caught up to, or drift that predates the head)" }); continue; }
    if (ruledAfter(was, commit)) { skipped.push({ slug, fields, why: `differs, but the store's row was ruled at window ${was.locked_window} (${new Date(was.locked_at).toISOString()}), after the file's last change ${commit.sha.slice(0, 9)} — the door's later word stands` }); continue; }
    amends.push({ slug, row, was, fields, commit });
  }

  if (pathAtBase) {
    for (const was of standing) {
      if (derivedBySlug.has(was.slug)) continue;
      const path = pathAtBase.get(was.slug);
      if (!path) continue;                                       // never in the file at the base: the door's, untouched
      if (held.has(was.slug)) { heldOut.push({ slug: was.slug, why: "HELD by the founder's word — refused by name" }); continue; }
      const commit = commitFor({ path, range: true, deleted: true });
      if (!commit) { skipped.push({ slug: was.slug, fields: ["(retire)"], why: `absent at this ref, but no commit since the head deleted ${path}` }); continue; }
      if (ruledAfter(was, commit)) { skipped.push({ slug: was.slug, fields: ["(retire)"], why: `absent at this ref, but the store's row was ruled at window ${was.locked_window}, after the deletion ${commit.sha.slice(0, 9)}` }); continue; }
      retires.push({ slug: was.slug, was, commit });
    }
  }

  // ── parents: the non-deferrable FK, resolved by SLUG ─────────────────────
  // `deriveSeed` spells a parent as uuid5(<parent slug>); the store's parent row
  // may carry a different id (a door-made mark's id is its locking claim's). So
  // the edge is re-pointed through the slug at the store's own id, and a parent
  // neither standing in the store nor added by this ingest is a STOP.
  const slugOfDerivedId = new Map(derived.map((r) => [String(r.id), r.slug]));
  const addedSlugs = new Set(adds.map((a) => a.slug));
  for (const c of [...adds, ...amends]) {
    c.parent = null;
    if (!c.row.parent) continue;
    const pslug = slugOfDerivedId.get(String(c.row.parent));
    const inStore = pslug ? bySlug.get(pslug) : null;
    if (inStore && inStore.status === "standing") c.parent = inStore.id;
    else if (pslug && addedSlugs.has(pslug)) c.parent = String(c.row.parent);
    else stops.push(`${c.slug}: its parent ${pslug ?? c.row.parent} is neither standing in the store nor added by this ingest — \`marks.parent\` is a non-deferrable foreign key`);
  }

  const sort = (a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
  return {
    adds: adds.sort(sort), amends: amends.sort(sort), retires: retires.sort(sort),
    skipped: skipped.sort(sort), held: heldOut.sort(sort), stops,
    retiresProvable: !!pathAtBase,
  };
}

// ── the receipt ──────────────────────────────────────────────────────────────

const NL = String.fromCharCode(10);
const who = (c) => `${c.commit.sha.slice(0, 9)} ${c.commit.author} — ${String(c.commit.subject).slice(0, 60)}`;

export function renderPlan(plan, { target, head, base, windowId, classMarks }) {
  const out = [];
  out.push(`marks-ingest · ${target.ref} @ ${target.sha.slice(0, 9)} · head ${head ? head.slice(0, 9) : "none"} · ` +
    `base ${base?.sha ? `${base.sha.slice(0, 9)} (${base.source})` : "none — no retire can be proven"} · window ${windowId ?? "?"}`);
  out.push(`class marks at this ref: ${classMarks} — LAW, law-ingest's pen (law_projection), not this one`);
  out.push(`${NL}ADD ${plan.adds.length}:`);
  for (const a of plan.adds) out.push(`  + ${a.slug}  [${a.row.kind}]  ${who(a)}`);
  out.push(`${NL}AMEND ${plan.amends.length}:`);
  for (const a of plan.amends) out.push(`  ~ ${a.slug}  fields: ${a.fields.join(", ")}  ${who(a)}`);
  out.push(`${NL}RETIRE ${plan.retires.length}:`);
  for (const r of plan.retires) out.push(`  - ${r.slug}  ${who(r)}`);
  if (plan.held.length) {
    out.push(`${NL}HELD ${plan.held.length}:`);
    for (const h of plan.held) out.push(`  · ${h.slug} — ${h.why}`);
  }
  if (plan.skipped.length) {
    out.push(`${NL}SKIPPED ${plan.skipped.length} (each says why; none is written):`);
    for (const s of plan.skipped) out.push(`  · ${s.slug}  fields: ${s.fields.join(", ")} — ${s.why}`);
  }
  if (plan.stops.length) {
    out.push(`${NL}STOP ${plan.stops.length} — the run refuses whole:`);
    for (const s of plan.stops) out.push(`  ! ${s}`);
  }
  return out.join(NL);
}

// ── the store's side ─────────────────────────────────────────────────────────

export const MARKS_SQL = `
  SELECT m.id::text AS id, m.slug, m.kind, m.owner, m.household, m.body, m.geometry, m.status,
         m.locked_window, m.retired_window, m.parent::text AS parent, m.data, w.closes_at AS locked_at
    FROM marks m LEFT JOIN windows w ON w.id = m.locked_window
   ORDER BY m.slug`;
export const HEAD_SQL = "SELECT sha FROM projection_heads WHERE repo = $1";
export const GENESIS_SQL = `
  SELECT receipts->'seeded_from'->>'world_sha' AS sha
    FROM windows WHERE receipts->>'note' = 'genesis seed' ORDER BY id LIMIT 1`;
export const OPEN_WINDOW_SQL = "SELECT id FROM windows WHERE status = 'open' ORDER BY id DESC LIMIT 1";
export const HEAD_UPSERT_SQL = `
  INSERT INTO projection_heads (repo, sha, ingested_at) VALUES ($1, $2, now())
  ON CONFLICT (repo) DO UPDATE SET sha = EXCLUDED.sha, ingested_at = EXCLUDED.ingested_at`;

/** What a write needs, checked before it writes (backfill-register § privilegeProbe's shape). */
export const WRITE_PRIVILEGES = [
  ["marks", "SELECT"], ["marks", "INSERT"], ["marks", "UPDATE"], ["windows", "SELECT"],
  ["claims", "INSERT"], ["projection_heads", "SELECT"], ["projection_heads", "INSERT"], ["projection_heads", "UPDATE"],
  ["households", "SELECT"], ["household_pins", "SELECT"], ["registry_meta", "SELECT"],
];

export async function missingPrivileges(q) {
  const checks = WRITE_PRIVILEGES.map(([t, p], i) => `has_table_privilege('${t}', '${p}') AS p${i}`).join(", ");
  const { rows: [r] } = await q(`SELECT current_user::text AS whoami, ${checks}`);
  return { whoami: r?.whoami ?? null, missing: WRITE_PRIVILEGES.filter((_, i) => !r?.[`p${i}`]).map(([t, p]) => `${p} on ${t}`) };
}

/** The provenance every ingested row carries: the commit that carried the file-side change. */
export const ingestedFrom = (commit, target) => ({
  sha: commit.sha, author: commit.author, at: commit.at, subject: commit.subject,
  ref: target.ref, ref_sha: target.sha,
});

/** An amend's claim id: deterministic, so a re-derivation names the same claim. */
export const amendClaimId = (slug, targetSha) => uuid5(`${CAUSE}:${targetSha}:${slug}`);

/**
 * Write the plan, inside the caller's transaction. The claim INSERT is
 * `backfill-register § applyBackfill`'s statement; the marks writes are
 * `materializeClaims` and `retireMarks` themselves.
 */
export async function applyIngest(q, plan, { windowId, target }) {
  const claims = [];
  const amendMap = new Map();
  const claimOf = (id, c, supersedes) => {
    const r = c.row;
    return {
      id, window_id: windowId, slug: c.slug, class: r.kind, claimant: r.owner, household: r.household,
      submitted_at: new Date(c.commit.at), status: "locked", decided_at: new Date(c.commit.at),
      body: r.body, geometry: r.geometry, bbox: r.bbox, stake: 0, parent: c.parent, supersedes,
      data: { ...(r.data ?? {}), _ingested_from: ingestedFrom(c.commit, target) },
    };
  };
  for (const a of plan.adds) claims.push(claimOf(String(a.row.id), a, null));
  for (const am of plan.amends) {
    const id = amendClaimId(am.slug, target.sha);
    const c = claimOf(id, am, am.was.id);
    // The identity trail (012_reidentification) is the MARK's, not this version's
    // provenance, so it survives the rewrite. Every other stamp belongs to the
    // prior version and stays on that version's own claim row.
    if (am.was.data?.formerly !== undefined) c.data.formerly = am.was.data.formerly;
    claims.push(c);
    amendMap.set(String(id), { id: am.was.id });
  }
  for (const c of claims) {
    await q(
      `INSERT INTO claims (id, window_id, slug, class, claimant, household, submitted_at,
                           status, decided_at, body, geometry, bbox, stake, data, parent, supersedes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [c.id, c.window_id, c.slug, c.class, c.claimant, c.household, c.submitted_at,
        c.status, c.decided_at, c.body, c.geometry ? JSON.stringify(c.geometry) : null,
        c.bbox, c.stake, JSON.stringify(c.data), c.parent, c.supersedes]);
  }
  const materialized = claims.length
    ? await materializeClaims(q, { claims, amends: amendMap, windowId, label: `${CAUSE} ${target.ref}` })
    : 0;

  let retired = { retired: [], already_retired: [], absent: [] };
  if (plan.retires.length) {
    retired = await retireMarks(q, { slugs: plan.retires.map((r) => r.slug), windowId, cause: CAUSE });
    // A retirement carries no claim, so its provenance rides the row it retired.
    for (const r of plan.retires) {
      await q(`UPDATE marks SET data = COALESCE(data, '{}'::jsonb) || $2::jsonb
                WHERE slug = $1 AND status = 'retired' AND retired_window = $3`,
        [r.slug, JSON.stringify({ _ingested_from: ingestedFrom(r.commit, target) }), windowId]);
    }
  }
  await q(HEAD_UPSERT_SQL, [HEAD_KEY, target.sha]);
  return { materialized, retired: retired.retired.map((r) => r.slug), already_retired: retired.already_retired, absent: retired.absent };
}

// ── the repo's side ──────────────────────────────────────────────────────────

const git = (repo, args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 << 20 });

/** A throwaway checkout at `sha` that writes nothing into `repo` (PR #173's test's checkout). */
export function checkoutAt(repo, sha, label) {
  const dir = mkdtempSync(join(tmpdir(), `marks-ingest-${label}-`));
  const at = join(dir, "w");
  execFileSync("git", ["clone", "-q", "--shared", "--no-checkout", repo, at], { stdio: "ignore" });
  git(at, ["-c", "advice.detachedHead=false", "checkout", "-q", sha]);
  return { dir: at, dispose: () => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) };
}

/** slug -> repo-relative path of its mark.md, through the world's own loader at that checkout. */
export async function pathsAt(checkout) {
  const mf = await import(pathToFileURL(join(checkout, "tools", "marks-fold.mjs")).href);
  const recs = mf.loadMarks(join(checkout, "WORLD", "marks"));
  const paths = new Map();
  let classMarks = 0;
  for (const r of recs) {
    if (r.kind === "class") { classMarks++; continue; }
    paths.set(r.id, relative(checkout, join(r._dir, "mark.md")).replace(/\\/g, "/"));
  }
  return { paths, classMarks };
}

/** The commit that carried a file-side change, read from the log. */
export function commitReader(repo, { base, target }) {
  const SEP = "\x1f";
  return ({ path, range, deleted }) => {
    if (!path) return null;
    const args = ["log", "-1", `--format=%H${SEP}%an${SEP}%cI${SEP}%s`];
    if (deleted) args.push("--diff-filter=D");
    args.push(range && base ? `${base}..${target}` : target, "--", path);
    const line = git(repo, args).trim();
    if (!line) return null;
    const [sha, author, at, subject] = line.split(SEP);
    return { sha, author, at: new Date(at).toISOString(), subject };
  };
}

const isAncestor = (repo, a, b) => {
  try { execFileSync("git", ["-C", repo, "merge-base", "--is-ancestor", a, b], { stdio: "ignore" }); return true; }
  catch { return false; }
};

/** `--ref` → { ref, sha }: a tag, a sha, or `blessed` (the newest settlement tag, as the fold serves it). */
export function resolveTarget(repo, ref) {
  if (ref === "blessed") {
    const b = blessed(repo);
    if (b.source !== "settlement") return { ref: null, sha: null, why: b.disclosed ?? "no settlement tag — there is no bless to ingest" };
    return { ref: b.tag, sha: b.sha };
  }
  return { ref, sha: git(repo, ["rev-parse", `${ref}^{commit}`]).trim() };
}

// ── the run ──────────────────────────────────────────────────────────────────

/**
 * One ingest. `client` is a pg client (or anything with `query`). Returns
 * `{ status, receipt, plan?, applied? }`; `status` is `noop`, `dry-run`,
 * `ingested` or `refused`. Never throws on a STOP — it refuses with the reason.
 */
export async function ingest(client, { worldRepo, ref = "blessed", since = null, dryRun = false, log = () => {} }) {
  const repo = resolve(worldRepo);
  const q = (text, args) => client.query(text, args);
  const target = resolveTarget(repo, ref);
  if (!target.sha) return { status: "noop", receipt: `nothing to ingest: ${target.why}` };

  await q(dryRun ? "BEGIN READ ONLY" : "BEGIN");
  let committed = false;
  try {
    const { rows: [h] } = await q(HEAD_SQL, [HEAD_KEY]);
    const head = h?.sha ?? null;
    if (head === target.sha) {
      return { status: "noop", receipt: `head already at ${target.ref} (${target.sha.slice(0, 9)}) — nothing to ingest` };
    }
    let base = null;
    if (since) base = { sha: git(repo, ["rev-parse", `${since}^{commit}`]).trim(), source: "--since" };
    else if (head) base = { sha: head, source: "the ingest head" };
    else {
      const { rows: [g] } = await q(GENESIS_SQL);
      if (g?.sha) base = { sha: g.sha, source: "the genesis seed" };
    }
    if (head && !isAncestor(repo, head, target.sha)) {
      return { status: "refused", receipt: `REFUSED: the ingest head ${head.slice(0, 9)} is not an ancestor of ${target.ref} — a bless that moved backwards is a ruling, not an ingest` };
    }
    if (base && !isAncestor(repo, base.sha, target.sha)) {
      return { status: "refused", receipt: `REFUSED: the base ${base.sha.slice(0, 9)} (${base.source}) is not an ancestor of ${target.ref}` };
    }
    const { rows: [w] } = await q(OPEN_WINDOW_SQL);
    const windowId = w ? Number(w.id) : null;

    const atRef = checkoutAt(repo, target.sha, "ref");
    const atBase = base ? checkoutAt(repo, base.sha, "base") : null;
    let plan, classMarks;
    try {
      const derivedAll = await deriveSeed({ worldRepo: atRef.dir, lawSha: target.sha });
      const ref_ = await pathsAt(atRef.dir);
      classMarks = ref_.classMarks;
      const pathAtBase = atBase ? (await pathsAt(atBase.dir)).paths : null;
      const { rows: storeRows } = await q(MARKS_SQL);
      plan = planIngest({
        derived: derivedAll.marks, storeRows, pathAtRef: ref_.paths, pathAtBase,
        commitFor: commitReader(repo, { base: base?.sha ?? null, target: target.sha }),
      });
    } finally {
      atRef.dispose();
      atBase?.dispose();
    }
    const receipt = renderPlan(plan, { target, head, base, windowId, classMarks });
    log(receipt);

    if (plan.stops.length) return { status: "refused", receipt: `${receipt}${NL}${NL}REFUSED: ${plan.stops.length} STOP(s) — nothing was written`, plan };
    if (dryRun) return { status: "dry-run", receipt: `${receipt}${NL}${NL}--dry-run: read inside BEGIN READ ONLY; nothing was written`, plan };
    if (windowId == null) return { status: "refused", receipt: `${receipt}${NL}${NL}REFUSED: no open window — an ingest is ruled at a window, and the candle is dark`, plan };

    const priv = await missingPrivileges(q);
    if (priv.missing.length) {
      return { status: "refused", receipt: `${receipt}${NL}${NL}REFUSED: the connection is \`${priv.whoami}\` and lacks ${priv.missing.join(", ")}. ` +
        "An ingest INSERTs claims and writes marks; 002_grants gives those halves to different roles, so connect as the owner (`world2_owner`), as backfill-register does.", plan };
    }
    const applied = await applyIngest(q, plan, { windowId, target });
    await q("COMMIT");
    committed = true;
    return {
      status: "ingested", plan, applied,
      receipt: `${receipt}${NL}${NL}INGESTED at window ${windowId}: ${plan.adds.length} added, ${plan.amends.length} amended, ` +
        `${applied.retired.length} retired · projection_heads['${HEAD_KEY}'] = ${target.sha}`,
    };
  } finally {
    if (!committed) { try { await q("ROLLBACK"); } catch { /* the connection is gone */ } }
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const argOf = (name) => { const i = process.argv.indexOf(name); return i !== -1 ? process.argv[i + 1] : null; };
const flag = (name) => process.argv.includes(name);

async function main() {
  const worldRepo = argOf("--world-repo");
  const ref = argOf("--ref") ?? "blessed";
  if (!worldRepo || !existsSync(worldRepo)) {
    console.error("usage: marks-ingest.mjs --world-repo <clone> --ref <tag|sha|blessed> [--since <ref>] [--dry-run]");
    process.exit(2);
  }
  if (!process.env.PGDATABASE && !process.env.PGUSER) {
    console.error("no PG* environment. For the owner role:\n  . /srv/world2-lab/ops/world2-lib.sh && w2_pgenv world2_owner PG_WORLD2_OWNER_PASSWORD");
    process.exit(2);
  }
  const { default: pg } = await import("pg");
  const client = new pg.Client();
  await client.connect();
  try {
    const r = await ingest(client, { worldRepo, ref, since: argOf("--since"), dryRun: flag("--dry-run") });
    console.log(r.receipt);
    // The last line is the machine receipt the unit's state file keeps.
    console.log(JSON.stringify({
      status: r.status, ref, adds: r.plan?.adds.length ?? 0, amends: r.plan?.amends.length ?? 0,
      retires: r.plan?.retires.length ?? 0, skipped: r.plan?.skipped.length ?? 0, stops: r.plan?.stops.length ?? 0,
    }));
    process.exitCode = r.status === "refused" ? 1 : 0;
  } catch (e) {
    console.error(`MARKS INGEST FAILED — nothing was written: ${e?.message ?? e}`);
    process.exitCode = 1;
  } finally {
    try { await client.end(); } catch { /* already closed */ }
  }
}

// The junction lesson (retire-unpublished.mjs): compare resolved real paths.
const invokedDirectly = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (invokedDirectly) await main();
