#!/usr/bin/env node
// snapshot-export.mjs — the NOTARY pen. Reads the database, writes the repo.
//
// THE LAW THIS IMPLEMENTS (gold plan postmark-world-2.md § 2 — quoted verbatim,
// because a pen should carry the sentence it is):
//
//   "Certification → the repo, as NOTARY (the anti-bucket role): periodic
//    certified snapshots binding (event-log cursor, content sha, law sha),
//    signed and tagged. Anyone can clone and verify what was certified when;
//    **the office cannot rewrite history without the repo catching it**."
//
//   "Durability obligation (named honestly): today a clone is a full off-box
//    backup, events included. After the split, events need an archive lane:
//    **each closed window exported append-only into `archives/`** — machine-
//    written but single-pen, **frozen-on-write, an input never re-derived-into**.
//    Clone-the-town becomes download-the-town."
//
// And gold § 3, anti-rebake rule 2, on this pen specifically:
//
//   "A fourth pen exists REPO-side only: `snapshot_exporter` (reads DB, writes
//    notary certifications + event archives into git — **never writes the DB**)."
//
// And census.md decision 1, the row that sends mark bodies back to the repo:
//
//   "mark BODIES | DB-source, riding the claim through the candle;
//    **`snapshot_exporter` writes bodies back to the repo so fork-and-read
//    survives**"
//
// ── THE THREE SURFACES, AND THE ONE THAT IS NOT LIKE THE OTHERS ─────────────
//
//   archives/acts/<window>.jsonl   ARCHIVE. Frozen on write. Written once, for a
//                                  CLOSED window, and never rewritten. If a
//                                  regeneration differs from a file that already
//                                  exists, this pen REFUSES and names the diff:
//                                  that is the office rewriting history, which is
//                                  the exact thing § 2 says the repo must catch.
//                                  A finding, never an overwrite.
//
//   WORLD2/marks/<slug>/mark.md    RENDER. Re-derived in full every run, because
//                                  the DB is the source (census decision 1) and
//                                  this is a view of it for fork-and-read. Editing
//                                  one of these files edits nothing: the next run
//                                  writes it back. Each file says so in its own
//                                  frontmatter, so a reader who found it by
//                                  cloning knows which kind of file they hold.
//
//   CERTIFICATION.json             The binding. (acts cursor, window cursor,
//                                  content sha, archives sha, law sha, town sha).
//                                  One commit carries all three; an annotated tag
//                                  `notary/<window>-<acts>` carries the
//                                  certification as its message.
//
// The asymmetry is the design. An archive is an input; a render is an output.
//
// ── THE STATELESS CONTRACT (gold § 3, and the sibling pens' own § in README) ─
//
// The CALLER supplies the target checkout. This pen never clones, fetches,
// creates, checks out, rebases, cleans, or pushes one, and keeps no state
// between runs — every run is a full re-derivation of the current database. It
// does commit and tag IN the caller's checkout; that is the pen's whole job.
//
// Its point is negative, exactly as § 3 states it: with no long-lived clone on
// the box, the month's whole clone-pathology class (wedged rebases, ownership
// poisonings, stash and upstream traps, ff-only freezes) is unrepresentable.
//
// ── IT MUST NOT BE ABLE TO WRITE THE DB ─────────────────────────────────────
//
// The credential is `snapshot_reader`, which 002_grants.sql gives SELECT and
// nothing else. This pen additionally REFUSES to run while holding one of the
// three writing pens' roles: a notary that could edit the thing it certifies is
// not a notary, and "the role happened to be handy" is how a fourth writer gets
// born (gold § 3 rule 2).
//
// ── USAGE ───────────────────────────────────────────────────────────────────
//
//   WORLD2_PG_URL=postgres://snapshot_reader:…@localhost/world2_dev \
//     node world2/tools/snapshot-export.mjs --target /path/to/notary-checkout
//
//   …                            --verify /path/to/notary-checkout
//   …                            --verify … --spot-check 200   (default 25)
//   …                            --target … --dry-run          (derive, write nothing)
//   …                            --json                        (machine-readable summary)
//
//   the operator door (POS-189), for ONE archive the database no longer
//   reproduces — every other differing archive still refuses:
//
//   …  --target … --refreeze 202 --reason "frozen before ferry 203 sailed"
//
// EXIT CODES:  0 green / nothing new to certify · 1 RED (drift, refusal) ·
//              2 cannot run (caller, credential, or setup — including
//                --refreeze with no --reason)
//
// ── THE RED-PROOF CARRIES THE RUN ───────────────────────────────────────────
//
// A falsifier nobody has watched fail is not a falsifier. Both reds are
// reproducible by hand, and the receipts are in README.md § the notary:
//
//   1. hand-edit a line in <target>/archives/acts/150.jsonl, re-run --target
//      → REFUSED, naming the line number and both spellings (append-only).
//   2. hand-edit the same in a scratch copy, run --verify
//      → RED, naming the archived line that disagrees with its acts row.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
// The town clock itself, not a second copy of its arithmetic. `crossings.mjs`
// was extracted out of world.mjs precisely so a small tool could read the clock
// without dragging the world in, and world2/tools already reads it this way
// (falsifier-guard-equality.mjs). See § THE TWO CLOCKS below for why this pen
// needs it at all.
import { CROSSING_EPOCH_UTC, CROSSING_MS, currentCrossing } from "../../src/crossings.mjs";

export const TOOL = "world2/tools/snapshot-export.mjs";

// The pens that hold write grants (002_grants.sql). Pen 4 must not be any of
// them, and world2_owner is migrations-only — running the notary as either would
// make "never writes the DB" a promise instead of a fact.
const WRITING_ROLES = new Set(["office_api", "clearing_job", "law_ingester", "world2_owner", "postgres"]);

// ── deterministic serialisation ──────────────────────────────────────────────

// Canonical JSON: keys sorted at every depth. `jsonb` stores a VALUE, not a
// document — it re-orders object keys on the way in — so the author's key order
// is already gone by the time this pen can see it, and sorting is the only
// spelling that two honest runs are guaranteed to agree on. (The seed importer
// and the projection falsifier learned this the same way: their first live runs
// went red on every row over key order alone.)
export function canonical(v) {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (typeof v === "object") {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

/**
 * A digest over a set of FILES, by (content, path). The recipe is stated here
 * and in README because a certification whose sha nobody can recompute certifies
 * nothing — "anyone can clone and verify what was certified when" is a promise
 * about a computation a stranger can run:
 *
 *   for each entry, sorted by key:  sha256(bytes) + "  " + key + "\n"
 *   digest = "sha256:" + sha256(concatenation of those lines)
 *
 * The sort is inside, not left to the caller, so the digest is a fact about the
 * SET of files and not about the order somebody happened to read them in.
 */
export function contentDigest(entries) {
  return "sha256:" + sha256([...entries]
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map(({ key, bytes }) => `${sha256(bytes)}  ${key}\n`).join(""));
}

// `numeric` and `bigint` arrive from pg as TEXT, on purpose — the driver will not
// silently narrow them. Emitting them as JSON numbers is right for a reader, but
// only if the narrowing is lossless, so it is checked rather than assumed. An
// archive is append-only and frozen: a digit dropped here is a digit dropped
// forever, and a silent one is exactly the lie this pen exists to catch.
export function exactNumber(text, what) {
  if (text === null || text === undefined) return null;
  const s = String(text);
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`${what}: '${s}' is not a finite number`);
  // Compare as decimal values, not spellings: '150.00' and '150' are the same
  // number and either is honest; '9007199254740993' -> 9007199254740992 is not.
  const norm = (t) => {
    let x = String(t).trim();
    if (!x.includes(".")) return x.replace(/^\+/, "").replace(/^(-?)0+(\d)/, "$1$2");
    x = x.replace(/0+$/, "").replace(/\.$/, "");
    return x.replace(/^\+/, "").replace(/^(-?)0+(\d)/, "$1$2");
  };
  if (norm(n.toString()) !== norm(s)) {
    throw new Error(
      `${what}: ${s} cannot be written as a JSON number without losing precision ` +
      `(round-trips to ${n}). Refusing rather than freezing a lossy digit into an append-only archive.`);
  }
  return n;
}

const iso = (d) => (d === null || d === undefined ? null : (d instanceof Date ? d : new Date(d)).toISOString());

// ── the acts archive ─────────────────────────────────────────────────────────

// The row grammar of an archived act, in a FIXED order — the whole `acts` row,
// because this file is the durability lane and "download-the-town" must be able
// to reconstruct what the log held, not a summary of it. `journal_seq` rides
// along and will simply be null in every window archived after the shadow era
// ends (001_tables.sql: it "DIES AT CUTOVER with the sqlite journal"); an archive
// already written keeps whatever was true when it was written. That is what
// frozen-on-write means.
const ACT_FIELDS = [
  "id", "at", "crossing", "actor", "action", "object",
  "at_anchor", "at_dx", "at_dy", "witnesses", "class", "payload",
  "effect", "household", "journal_seq", "inserted_at",
];

export function archiveLine(row) {
  const out = {};
  for (const f of ACT_FIELDS) {
    switch (f) {
      case "id": out.id = exactNumber(row.id, `acts.id ${row.id}`); break;
      case "crossing": out.crossing = exactNumber(row.crossing, `acts.crossing (id ${row.id})`); break;
      case "journal_seq": out.journal_seq = row.journal_seq === null ? null : exactNumber(row.journal_seq, `acts.journal_seq (id ${row.id})`); break;
      case "at": case "inserted_at": out[f] = iso(row[f]); break;
      case "at_dx": case "at_dy": out[f] = row[f] === null ? null : Number(row[f]); break;
      default: out[f] = row[f] === undefined ? null : row[f];
    }
  }
  // Object keys are emitted in insertion order (all keys here are non-numeric),
  // and nested jsonb values are canonicalised — so one row has exactly one line.
  return `{${ACT_FIELDS.map((f) => `${JSON.stringify(f)}:${canonical(out[f])}`).join(",")}}`;
}

/**
 * WHICH ACTS BELONG TO WHICH WINDOW — the one ruling this pen had to make.
 *
 * By the CROSSING, not by the clock: window N archives every act whose crossing
 * falls in (previous closed window's id, N]. The genesis window has no previous
 * window, so it has no lower bound, and the legacy backfill (crossings 118–149,
 * imported by the seed) rides with it — which is the brief's own instruction and
 * the only home those rows have.
 *
 * Not by `at` BETWEEN opens_at AND closes_at, and the seeded genesis window is
 * why: its `opens_at` is the log meta's `covers_from` (2026-08-26T00:00Z), a
 * fact about a file rather than a crossing boundary, and every legacy act falls
 * before it. A time bound would have archived an empty genesis window and called
 * it complete. The crossing IS the town's clock (gold § 1); the timestamps are
 * evidence.
 *
 * Acts beyond the highest closed window are not archived by anyone yet — their
 * window has not closed. They are counted and named in the summary, never
 * silently dropped.
 */
export function actsRangeFor(windowId, previousClosedId) {
  return { after: previousClosedId, upto: windowId };
}

// ── THE TWO CLOCKS, AND WHY A CLOSED WINDOW IS NOT YET A FINISHED ONE ────────
//
// This pen selected its windows on one clock and its acts on another, and the
// two do not agree about when window N stops growing.
//
//   windows.status = 'closed'   the SETTLEMENT clock. Windows close at the
//                               06:00Z / 18:00Z clearings.
//   acts.crossing               the FERRY clock. Ferries sail 00:00Z / 12:00Z
//                               (crossings.mjs, the ratified derivation).
//
// WHICH FERRY AN ACT'S NUMBER NAMES — the direction the whole rule turns on.
// Every writer stamps `crossing: currentCrossing()` (src/world-apex.mjs,
// src/world-hold.mjs, src/world.mjs), and `currentCrossing(now)` is
// `floor((now − epoch) / 12h)` — the ferry that LAST SAILED, not the next one.
// The pen that guards the insert says so in its own variable name:
// world2-pen.mjs § lateCrossingGuard, `const open = currentCrossing(now)`, and
// it throws on `crossing > open` because "the future is not a place a row can
// file into". So an act numbered N is an act that arrived in
// [ferry N sails, ferry N+1 sails) — and window N goes on growing until ferry
// N+1 has sailed.
//
// THE INSTANCE (measured on the box, 2026-09-21/22, postmark POS-189). Ferry
// 202 sailed 2026-09-21T00:00Z. At 07:22Z the settlement clock had already
// closed window 202, and this pen froze it at 84 acts. Acts numbered 202 then
// kept arriving — id 7181 at 07:47Z, id 7182 at 09:13Z — until the 12:00Z
// ferry, which is ferry 203. The next night re-derived 94 and REFUSED, exactly
// as § 2 says it must: from the repo's side, a window that grew after it was
// frozen is indistinguishable from the office rewriting history. The refusal
// was right; freezing that early was the defect. Red stood from 09-22 07:22Z
// until a hand cleared it at 14:11Z.
//
// THE RULE THIS BUILDS: a window is archivable only once the ferry AFTER it has
// sailed. Window 204 was archivable at 14:11Z on 09-22 (ferry 205 sailed at
// 12:00Z); window 205 was not, and was correctly left alone.
//
// RESIDUAL, named because a rule should say where it stops being total:
// `world2-pen.mjs § crossingIsLate` is `c < open − 1`, so a row stamped N may
// still file without a reason while the open window is N+1 — the sub-second
// race of a row composed just before a boundary and inserted just after. This
// rule does not cover that race; holding a second ferry would, at the cost of
// twelve more hours before every archive. The notary runs at 07:22Z, seven
// hours from either boundary, so the race is not the failure that was measured.

/** The instant ferry N sails, ISO, from the town clock's own epoch and interval. */
export function crossingSailsAt(n) {
  return new Date(CROSSING_EPOCH_UTC + Number(n) * CROSSING_MS).toISOString();
}

/** The ferry whose sailing completes window N — the one after it (see above). */
export const completingFerryFor = (windowId) => Number(windowId) + 1;

/**
 * Split the settlement-closed windows into the ones whose ferry has sailed and
 * the ones still growing. Window ids rise, so the held set is always a suffix.
 * `now` is an argument, not a read of the wall clock, because a clock a test
 * cannot move is a clause a test cannot falsify.
 */
export function ferryPartition(windows, now = Date.now()) {
  const open = currentCrossing(typeof now === "number" ? now : new Date(now).getTime());
  const archivable = [];
  const held = [];
  for (const w of windows) {
    const id = Number(w.id);
    const ferry = completingFerryFor(id);
    if (ferry <= open) archivable.push(w);
    else held.push({ ...w, id, ferry, sailsAt: crossingSailsAt(ferry) });
  }
  return { archivable, held, open };
}

/** How a held window says itself, beside the held-back acts line it belongs with. */
export function heldWindowLine(h) {
  return `window ${h.id} closed on the settlement clock; ferry ${h.ferry} sails at ${h.sailsAt}` +
    ` — acts numbered ${h.id} may still arrive until it does, so the archive is not complete`;
}

// ── the mark render ──────────────────────────────────────────────────────────

// A string that YAML would read back as something OTHER than a string. These are
// quoted, and the list is why the render can be trusted about types: `pre: "true"`
// is a STRING in `data`, and writing it bare would hand the next reader a boolean
// the database never held; `date: 2026-07-23` bare is a YAML date, not the text
// the mark's frontmatter carried. (Caught by this file's own test, which is the
// only reason the list exists.)
const YAML_KEYWORD = /^(?:true|false|yes|no|on|off|null|~)$/i;
const NUMBERLIKE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const DATELIKE = /^\d{4}-\d{2}-\d{2}(?:[T ]|$)/;
// No ':' (a mapping), no '#' (a comment), no quote or bracket, no leading or
// doubled space — the charset is deliberately narrow, because the fallback is
// JSON, which is always correct and only ever uglier.
const BARE_SAFE = /^[A-Za-z0-9][A-Za-z0-9._/@+-]*(?: [A-Za-z0-9._/@+-]+)*$/;

// One frontmatter line. Scalars are written bare only when YAML will read them
// back as the same string; structured values are canonical JSON, which is valid
// YAML flow style — so the file parses as YAML frontmatter without this pen
// shipping a YAML writer it would then have to be trusted about.
function fmValue(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v !== "string") return canonical(v);
  const bare = BARE_SAFE.test(v) && !YAML_KEYWORD.test(v) && !NUMBERLIKE.test(v) && !DATELIKE.test(v);
  return bare ? v : JSON.stringify(v);
}

/**
 * A mark as a file. This is a RENDER of `marks` (census decision 1: mark bodies
 * are DB-source), not an attempt to reproduce the 1.0 authored file — `data` is
 * "the record's remainder, not a second schema" (seed-import's ruling), so it is
 * rendered as itself, key-sorted, rather than splatted back into the frontmatter
 * shape a human once typed. What a 1.0 reader wants is all here; what a 1.0
 * PARSER wants is a phase-3 question and deliberately not answered here.
 *
 * `bbox` is not rendered: 001_tables.sql calls it "writer-computed from
 * geometry". Rendering a derived column beside the thing it derives from would
 * invite a reader to believe the two could disagree.
 */
export function renderMark(m) {
  const lines = ["---"];
  const put = (k, v) => lines.push(`${k}: ${fmValue(v)}`);
  put("slug", m.slug);
  put("kind", m.kind);
  put("owner", m.owner);
  put("household", m.household);
  put("status", m.status);
  put("locked_window", m.locked_window === null ? null : Number(m.locked_window));
  if (m.retired_window !== null && m.retired_window !== undefined) put("retired_window", Number(m.retired_window));
  put("id", m.id);
  // The two edges a mark can carry, and they are different KINDS of edge —
  // merged 2026-08-28 as the durable shape, not a stopgap (README § the 76
  // class-parented marks): a marks-parent is a uuid, a law-parent is a key into
  // law_projection, and folding them into one field would be false uniformity.
  put("parent", m.parent ?? null);
  const parentLaw = m.data && Object.prototype.hasOwnProperty.call(m.data, "_parent_is_law") ? m.data._parent_is_law : null;
  if (parentLaw) put("parent_law", parentLaw);
  if (m.geometry === null || m.geometry === undefined) {
    // Not an omission: 004's CHECK says what stands IN the world has a where and
    // what continues a parent does not. The null is the fact.
    put("geometry", null);
  } else {
    put("geometry", m.geometry);
  }
  if (m.data && Object.keys(m.data).length) {
    lines.push("data:");
    for (const k of Object.keys(m.data).sort()) lines.push(`  ${k}: ${fmValue(m.data[k])}`);
  } else {
    put("data", m.data ?? null);
  }
  put("rendered_by", `${TOOL} — a RENDER of DB-source, re-derived in full on every export; edit the world, not this file`);
  lines.push("---", "");
  const body = m.body ?? "";
  return lines.join("\n") + body + (body.endsWith("\n") ? "" : "\n");
}

export const markPath = (slug) => path.posix.join("WORLD2", "marks", slug, "mark.md");

// A slug becomes a path, so it is checked before it becomes one. `..`, absolute
// forms, backslashes and trailing dots (which Win32 cannot address at all — a
// resident handle ending in '.' has already cost this town a directory it could
// not delete) never reach the filesystem.
export function safeSlug(slug) {
  if (typeof slug !== "string" || !slug.length) return "slug is empty";
  if (slug !== slug.trim()) return "slug has leading or trailing whitespace";
  if (slug.startsWith("/") || /^[A-Za-z]:/.test(slug)) return "slug is an absolute path";
  if (slug.includes("\\")) return "slug contains a backslash";
  const parts = slug.split("/");
  if (parts.length !== 2) return `slug is not <owner>/<name> (${parts.length} segment(s))`;
  for (const p of parts) {
    if (!p.length) return "slug has an empty segment";
    if (p === "." || p === "..") return "slug has a relative segment";
    if (p.endsWith(".")) return "slug segment ends in '.' (unaddressable on Win32)";
    if (/[\u0000-\u001f<>:"|?*]/.test(p)) return "slug segment has a character no filesystem should be asked to hold";
  }
  return null;
}

// ── reading the database (SELECT only, always) ───────────────────────────────

async function readWindows(client) {
  const { rows } = await client.query(
    "SELECT id, opens_at, closes_at, status, law_sha, town_sha, cleared_at FROM windows WHERE status = 'closed' ORDER BY id");
  return rows.map((w) => ({ ...w, id: Number(w.id) }));
}

async function readActs(client, { after, upto }) {
  const sql = after === null
    ? "SELECT * FROM acts WHERE crossing IS NOT NULL AND crossing <= $1 ORDER BY id"
    : "SELECT * FROM acts WHERE crossing IS NOT NULL AND crossing > $2 AND crossing <= $1 ORDER BY id";
  const { rows } = await client.query(sql, after === null ? [upto] : [upto, after]);
  return rows;
}

async function readMarks(client) {
  const { rows } = await client.query(
    "SELECT id, slug, kind, owner, household, body, geometry, status, locked_window, retired_window, data, parent FROM marks ORDER BY slug");
  return rows;
}

async function readCursors(client) {
  const { rows } = await client.query(
    "SELECT (SELECT max(id) FROM acts) AS acts_cursor, (SELECT count(*) FROM acts) AS acts_total, (SELECT count(*) FROM marks) AS marks_count");
  return {
    acts_cursor: rows[0].acts_cursor === null ? 0 : exactNumber(rows[0].acts_cursor, "max(acts.id)"),
    acts_total: Number(rows[0].acts_total),
    marks_count: Number(rows[0].marks_count),
  };
}

// ── the certification ────────────────────────────────────────────────────────

const CERT_FILE = "CERTIFICATION.json";

/**
 * The binding, in gold § 2's own terms: "(event-log cursor, content sha, law
 * sha)". `archives` and `archives_sha` are here beyond that list because the
 * cursor alone binds only the log's LENGTH — it would notice an act appended and
 * miss an act rewritten, and "the office cannot rewrite history without the repo
 * catching it" is the sentence this file exists to make true.
 */
export function certification({ cursors, windowCursor, pins, marksDigest, archives, exportedAt }) {
  return {
    certified_by: `${TOOL} (snapshot_exporter — pen 4, repo-side notary)`,
    acts_cursor: cursors.acts_cursor,
    window_cursor: windowCursor,
    marks_count: cursors.marks_count,
    marks_content_sha: marksDigest,
    archives: archives.map((a) => ({ window: a.window, lines: a.lines, sha256: sha256(a.bytes) })),
    archives_sha: contentDigest(archives.map((a) => ({ key: String(a.window), bytes: a.bytes }))),
    law_sha: pins.law_sha,
    town_sha: pins.town_sha,
    exported_at: exportedAt,
  };
}

// Everything a re-run must reproduce. `exported_at` is when, not what: two
// honest runs of the same database differ by it and by nothing else, so it is
// the one field a comparison must leave out — otherwise "idempotent" could never
// be true and this pen would tag a new certification every time it looked.
export function certificationSubstance(c) {
  const { exported_at, ...rest } = c ?? {};
  return canonical(rest);
}

const writeCert = (c) => JSON.stringify(c, null, 2) + "\n";

// ── git, in the caller's checkout ────────────────────────────────────────────

// The notary signs as itself. It is a machine pen with a single hand, and a
// commit that borrowed whichever identity the checkout happened to be configured
// with would make the archive's authorship a fact about the caller.
const NOTARY_IDENT = [
  "-c", "user.name=Postmark World 2.0 notary",
  "-c", "user.email=notary@postmark.town",
];

function git(target, args, { ident = false, input } = {}) {
  return execFileSync("git", ["-C", target, ...(ident ? NOTARY_IDENT : []), ...args],
    { encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024 }).trim();
}

// "Does this ref exist?" — asked of git, which answers a missing ref on stderr.
// Swallowed on purpose: a `fatal: Needed a single revision` printed above a green
// run teaches a reader to skim past fatals, and the next one will be real.
function gitOk(target, args) {
  try { execFileSync("git", ["-C", target, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); return true; }
  catch { return false; }
}

export function assertUsableTarget(target, { allowDetached }) {
  if (!target) throw new Cannot("no --target given. This pen never creates a checkout; the caller supplies one.");
  if (!existsSync(target) || !statSync(target).isDirectory()) throw new Cannot(`--target ${target} is not a directory`);
  let top;
  try { top = git(target, ["rev-parse", "--show-toplevel"]); }
  catch { throw new Cannot(`--target ${target} is not a git checkout. The notary writes INTO a repo the caller supplies; it does not make one.`); }
  if (git(target, ["rev-parse", "--is-bare-repository"]) === "true") throw new Cannot(`--target ${target} is a bare repository — there is nowhere to write files.`);

  // THE TARGET MUST BE THE REPO ROOT, and this check is not pedantry. `git -C
  // <a-directory-that-is-not-a-repo>` does not fail — it WALKS UP until it finds
  // one, and this town has already watched that walk reach a home directory and
  // stage it. A notary handed a plain temp directory would otherwise commit its
  // certification into whatever ancestor repo happened to be above it. (Found by
  // this file's own test, which passed a bare tmpdir and got a toplevel back.)
  if (realpathSync(top) !== realpathSync(target)) {
    throw new Cannot(
      `--target ${target} is not a repository root: git resolves it to ${top}. ` +
      `git walks UP out of a non-repo directory, so a target that is merely INSIDE some repo would have this pen commit ` +
      `into a repo nobody chose. Point --target at the notary checkout's own root.`);
  }
  if (!allowDetached) {
    const branch = git(target, ["rev-parse", "--abbrev-ref", "HEAD"]);
    if (branch === "HEAD") {
      throw new Cannot(
        `--target ${target} is on a DETACHED HEAD. A certification committed here is reachable only by its tag, and a push of it ` +
        `reports success while shipping nothing — a trap this town has already paid for. Check out a branch, or pass --allow-detached ` +
        `if the tag really is the whole deliverable.`);
    }
  }
  return top;
}

export class Cannot extends Error {}   // exit 2: the caller or the setup, not the data
export class Red extends Error {       // exit 1: drift, named
  constructor(message, findings = []) { super(message); this.findings = findings; }
}

// ── derive: everything both modes need, from the database alone ──────────────

// EXPORTED so the ferry gate can be falsified where it is WIRED, not only where
// it is computed. A test that only asserted `ferryPartition` would stay green
// through a revert of the two lines below, which is a probe that cannot fail.
export async function derive(client, { now = Date.now() } = {}) {
  const closed = await readWindows(client);
  if (!closed.length) {
    throw new Cannot("no CLOSED window exists. There is nothing certified to certify — a notary that signed an empty book would be worse than one that refused.");
  }
  // THE FERRY CLOCK GATE (see § THE TWO CLOCKS). A window the settlement clock
  // has closed is still growing until the ferry after it has sailed, and an
  // archive is frozen on write — so freezing one early is not a small error, it
  // is a file that every later run must refuse.
  const { archivable: windows, held } = ferryPartition(closed, now);
  if (!windows.length) {
    throw new Cannot(
      `every CLOSED window is still awaiting its ferry, so there is nothing complete to freeze yet:\n  ` +
      held.map(heldWindowLine).join("\n  "));
  }
  const cursors = await readCursors(client);
  const latest = windows[windows.length - 1];

  const archives = [];
  let previous = null;
  for (const w of windows) {
    const rows = await readActs(client, actsRangeFor(w.id, previous));
    archives.push({
      window: w.id,
      lines: rows.length,
      bytes: rows.map(archiveLine).join("\n") + (rows.length ? "\n" : ""),
      path: path.posix.join("archives", "acts", `${w.id}.jsonl`),
    });
    previous = w.id;
  }

  const marks = await readMarks(client);
  const rendered = [];
  for (const m of marks) {
    const bad = safeSlug(m.slug);
    if (bad) throw new Red(`marks.slug ${JSON.stringify(m.slug)} cannot become a path: ${bad}`);
    rendered.push({ slug: m.slug, path: markPath(m.slug), bytes: renderMark(m) });
  }
  const marksDigest = contentDigest(rendered.map((r) => ({ key: r.path, bytes: r.bytes })));

  // Acts no archive owns yet — because their window has not closed, or because
  // it has closed but its ferry has not sailed. Counted and named, because a
  // durability lane that silently held rows back would be a backup with a hole
  // in it. `held` names the second reason window by window.
  const heldBack = cursors.acts_total - archives.reduce((n, a) => n + a.lines, 0);

  return {
    windows, held, latest, cursors, archives, rendered, marksDigest, heldBack,
    windowCursor: latest.id,
    pins: { law_sha: latest.law_sha, town_sha: latest.town_sha },
  };
}

const tagName = (d) => `notary/${d.windowCursor}-${d.cursors.acts_cursor}`;

// ── mode: export ─────────────────────────────────────────────────────────────

function excerpt(a, b, width = 120) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const from = Math.max(0, i - 20);
  const cut = (s) => (from > 0 ? "…" : "") + s.slice(from, from + width) + (from + width < s.length ? "…" : "");
  return { at: i, a: cut(a), b: cut(b) };
}

// ── DECLARED RE-FREEZES (POS-242 item 3, shape A ruled 2026-10-01) ──────────
//
// A migration or backfill that changes already-archived history declares it,
// in its own PR, in world2/schema/REFREEZES.json — and this pen re-freezes ONLY
// the differing archives whose difference VERIFIES as a declared class. Every
// other difference still refuses, exactly as below. The case it is built from:
// 2026-09-28, migration 025 dropped acts.journal_seq and the w40.3 backfill
// (office #220) put acts into closed windows; 26 archives re-derived
// differently and the notary stayed red until a hand re-froze them through the
// operator door (notary repo 85da0af17, Keemin's go).
//
//   { "declarations": [ {
//       "id":     "025-drop-journal-seq",         unique; consumed ONCE
//       "class":  "drop-field" | "field-change" | "rows-added",
//       "field":  "journal_seq",                  drop-field / field-change only
//       "reason": "<what changed history, and why>",
//       "go":     "<whose go, and when>" } ] }
//
// THE CLASSES, as a re-derived archive is compared with the frozen one, act by act:
//   drop-field <f>   every frozen act is still derived, and on each the only
//                    difference is <f> becoming null or absent. NULL COUNTS AS
//                    DROPPED, measured rather than chosen: ACT_FIELDS is fixed,
//                    so archiveLine renders a dropped column as `"f":null` —
//                    09-28's window 201 diff is exactly `journal_seq: 3720 -> null`.
//   field-change <f> on each still-derived act, <f> may differ (or newly appear).
//   rows-added       acts may appear that the frozen archive does not hold.
// Classes compose: 09-28 was a drop-field and a rows-added over the same
// windows. No class removes an act, and no class excuses any field it does not
// name: a payload that moved under a drop-field declaration refuses.
//
// SCOPE IS THE CLASS, NOT A LIST: any CLOSED window whose difference matches.
// The author of a backfill cannot know in advance which windows it touches.
//
// CONSUMED ONCE, in the notary repo: REFREEZES-CONSUMED.json records each id with the
// windows it re-froze, in the same commit. A consumed id never excuses again.
export const DECLARATION_CLASSES = new Set(["drop-field", "field-change", "rows-added"]);
export const REFREEZES_MANIFEST = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "schema", "REFREEZES.json");
export const CONSUMED_FILE = "REFREEZES-CONSUMED.json";

/**
 * The manifest, validated whole, minus every id the target's ledger has
 * consumed. A manifest this pen cannot read in full is Cannot (exit 2): a
 * declaration half-understood must not excuse anything.
 */
export function loadDeclarations(manifestText, consumedText = null) {
  let m;
  try { m = JSON.parse(manifestText); } catch (e) { throw new Cannot(`REFREEZES.json is not readable JSON: ${e.message}`); }
  if (!m || !Array.isArray(m.declarations)) throw new Cannot("REFREEZES.json carries no `declarations` list");
  const seen = new Set();
  for (const d of m.declarations) {
    const where = `REFREEZES.json declaration ${JSON.stringify(d?.id ?? null)}`;
    if (typeof d?.id !== "string" || !/^[a-z0-9][a-z0-9._-]*$/.test(d.id)) throw new Cannot(`${where}: id must be a lowercase slug`);
    if (seen.has(d.id)) throw new Cannot(`${where}: the id is declared twice`);
    seen.add(d.id);
    if (!DECLARATION_CLASSES.has(d.class)) throw new Cannot(`${where}: class must be one of ${[...DECLARATION_CLASSES].join(", ")}`);
    if (d.class === "rows-added" ? d.field !== undefined : (typeof d.field !== "string" || !/^[a-z_][a-z0-9_]*$/.test(d.field))) {
      throw new Cannot(`${where}: ${d.class === "rows-added" ? "rows-added names no field" : `${d.class} must name its field`}`);
    }
    for (const k of ["reason", "go"]) if (typeof d[k] !== "string" || !d[k].trim()) throw new Cannot(`${where}: ${k} is required — a re-freeze nobody owns is the thing this pen exists to catch`);
  }
  let consumed = [];
  if (consumedText !== null) {
    try { consumed = JSON.parse(consumedText).consumed; } catch (e) { throw new Cannot(`${CONSUMED_FILE} is not readable JSON: ${e.message}`); }
    if (!Array.isArray(consumed)) throw new Cannot(`${CONSUMED_FILE} carries no \`consumed\` list`);
  }
  const spent = new Set(consumed.map((c) => c.id));
  return { declarations: m.declarations.filter((d) => !spent.has(d.id)), consumed };
}

/**
 * Does the difference between a frozen archive and its re-derivation verify as
 * the declared classes? `{ ok: true, used }` names the declarations it needed;
 * `{ ok: false, why }` names the first act and field that no class excuses.
 */
export function verifyDeclared(have, want, declarations) {
  const parse = (bytes, side) => {
    const out = new Map();
    for (const [i, l] of bytes.replace(/\n$/, "").split("\n").filter(Boolean).entries()) {
      let o; try { o = JSON.parse(l); } catch { return { bad: `${side} line ${i + 1} is not JSON` }; }
      out.set(o.id, o);
    }
    return { rows: out };
  };
  const a = parse(have, "the frozen archive's"), b = parse(want, "the re-derived");
  if (a.bad || b.bad) return { ok: false, why: a.bad ?? b.bad };
  const of = (cls) => declarations.filter((d) => d.class === cls);
  const used = new Set();
  for (const [id] of a.rows) if (!b.rows.has(id)) return { ok: false, why: `act ${id} is frozen but no longer derived — no class removes an act` };
  const added = [...b.rows.keys()].filter((id) => !a.rows.has(id));
  if (added.length) {
    const r = of("rows-added");
    if (!r.length) return { ok: false, why: `${added.length} act(s) appear (ids ${added.slice(0, 5).join(", ")}${added.length > 5 ? ", …" : ""}) and no rows-added is declared` };
    used.add(r[0].id);
  }
  for (const [id, o] of a.rows) {
    const n = b.rows.get(id);
    for (const k of new Set([...Object.keys(o), ...Object.keys(n)])) {
      if (canonical(o[k] ?? null) === canonical(n[k] ?? null) && (k in o) === (k in n)) continue;
      const change = of("field-change").find((d) => d.field === k);
      if (change) { used.add(change.id); continue; }
      const drop = of("drop-field").find((d) => d.field === k);
      if (drop && k in o && (n[k] === undefined || n[k] === null)) { used.add(drop.id); continue; }
      return { ok: false, why: `act ${id}: ${k} ${canonical(o[k] ?? null).slice(0, 60)} -> ${canonical(n[k] ?? null).slice(0, 60)}, which no declared class excuses${drop ? ` (drop-field ${k} covers only a value that becomes null or absent)` : ""}` };
    }
  }
  // In the manifest's own order, so the receipt reads the way the declarations were written.
  return { ok: true, used: declarations.filter((d) => used.has(d.id)).map((d) => d.id) };
}

/** The ledger after this run's declared re-freezes: each id once, with its windows. */
export function consumeDeclarations(consumed, plan, at) {
  const byId = new Map();
  for (const a of plan) {
    if (a.action !== "refreeze-declared") continue;
    for (const id of a.declarations) {
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(a.window);
    }
  }
  const next = [...consumed, ...[...byId].map(([id, windows]) => ({ id, windows, at }))];
  return `${JSON.stringify({ consumed: next }, null, 1)}\n`;
}

/**
 * THE APPEND-ONLY CHECK. "frozen-on-write, an input never re-derived-into."
 *
 * Idempotency is decided by the TARGET's files, never by DB state — the pen is
 * stateless, so what has already been archived is a question only the target can
 * answer. An existing file is regenerated and compared; if it differs, this is a
 * REFUSAL with the line named, not an overwrite. The whole point of § 2 is that
 * the repo catches the office rewriting history, and a pen that quietly restated
 * the archive would be the office's accomplice.
 *
 * THE OPERATOR DOOR (`refreeze`, POS-189; the 2026-09-14 rule that every guard
 * gets an operator door with a receipt). A guard with no door is a defect: when
 * this pen itself froze a window early, the only way past its own refusal was a
 * hand removing the file from the notary repo with the reason in a commit
 * message nobody had to write. So the door is here instead — ONE window,
 * named by number, replaced by the re-derived bytes, with the old sha, the new
 * sha and the operator's reason on the commit's first line. It narrows rather
 * than widens: every other differing archive refuses exactly as before, which
 * is why the refusal test above stays untouched and green.
 */
export function checkArchives(target, archives, { refreeze = null, declared = [] } = {}) {
  const findings = [];
  const plan = [];
  const wanted = refreeze === null ? null : new Set((Array.isArray(refreeze) ? refreeze : [refreeze]).map(Number));
  for (const a of archives) {
    const full = path.join(target, a.path);
    if (!existsSync(full)) { plan.push({ ...a, action: "write" }); continue; }
    const have = readFileSync(full, "utf8");
    if (have === a.bytes) { plan.push({ ...a, action: "unchanged" }); continue; }

    if (wanted !== null && wanted.has(Number(a.window))) {
      plan.push({ ...a, action: "refreeze", was: have, oldSha: sha256(have), newSha: sha256(a.bytes) });
      continue;
    }
    const verdict = declared.length ? verifyDeclared(have, a.bytes, declared) : null;
    if (verdict?.ok) {
      plan.push({ ...a, action: "refreeze-declared", was: have, oldSha: sha256(have), newSha: sha256(a.bytes), declarations: verdict.used });
      continue;
    }

    const hl = have.length ? have.replace(/\n$/, "").split("\n") : [];
    const wl = a.bytes.length ? a.bytes.replace(/\n$/, "").split("\n") : [];
    const detail = [];
    if (hl.length !== wl.length) detail.push(`line count ${hl.length} on disk, ${wl.length} re-derived`);
    for (let i = 0; i < Math.max(hl.length, wl.length) && detail.length < 6; i++) {
      if (hl[i] === wl[i]) continue;
      if (hl[i] === undefined) { detail.push(`line ${i + 1}: absent on disk, re-derived as ${wl[i].slice(0, 160)}`); continue; }
      if (wl[i] === undefined) { detail.push(`line ${i + 1}: on disk but the database no longer derives it: ${hl[i].slice(0, 160)}`); continue; }
      const x = excerpt(hl[i], wl[i]);
      detail.push(`line ${i + 1} differs at char ${x.at}\n      on disk: ${x.a}\n      derived: ${x.b}`);
    }
    findings.push(
      `${a.path} is an ARCHIVE and already exists, and re-deriving it does not reproduce it.\n` +
      `    ${detail.join("\n    ")}\n` +
      `    An archive is frozen on write (gold §2). This is drift and a FINDING — the notary will not overwrite it.\n` +
      `    Either the file was edited, or the office rewrote history in a window it had already closed. Both want a human.` +
      (verdict ? `\n    It does not verify as a declared re-freeze (${declared.map((d) => d.id).join(", ")}): ${verdict.why}` : ""));
  }
  return { plan, findings };
}

const lineCount = (s) => (s.replace(/\n$/, "").length ? s.replace(/\n$/, "").split("\n").length : 0);

/**
 * The door's RECEIPT. Both sha256s and the operator's reason ride the first
 * line, because that is the line `git log --oneline` shows and the line a
 * reader scanning the notary repo's history will actually read: a replacement
 * of a frozen archive must not be able to look like an ordinary certification.
 */
export function refreezeCommitMessage(a, reason, d) {
  return `notary: refreeze archives/acts/${a.window}.jsonl — old sha256 ${a.oldSha}, new sha256 ${a.newSha} — ${reason}\n\n` +
    `An archive is frozen on write (gold § 2). This run replaced one anyway, through the operator door\n` +
    `\`--refreeze ${a.window} --reason "<text>"\`, and the two sha256s above are the whole receipt: anyone holding\n` +
    `the previous commit can read exactly what stood here and exactly what replaced it.\n\n` +
    `old sha256 ${a.oldSha} · ${lineCount(a.was)} line(s)\n` +
    `new sha256 ${a.newSha} · ${a.lines} line(s)\n` +
    `reason: ${reason}\n\n` +
    `No other window was touched. Every other differing archive still refuses.\n` +
    `window cursor ${d.windowCursor} · acts cursor ${d.cursors.acts_cursor}\n\nWritten by ${TOOL}.`;
}

/**
 * The door's receipt for SEVERAL windows in one run (2026-09-28, the w40 ship's
 * history change: migration 025 dropped journal_seq and a backfill added acts to
 * closed windows, so 26 archives differed at once and the one-window door could
 * never start — any other differing archive refuses the whole run). Same rule as
 * the single receipt: the operator's reason on the first line, and every
 * window's old and new sha256 in the body, one line each, so the commit is still
 * the whole receipt.
 */
export function refreezeManyCommitMessage(list, reason, d) {
  const ws = list.map((a) => a.window);
  return `notary: refreeze ${list.length} archives (${ws.join(", ")}) — ${reason}\n\n` +
    `An archive is frozen on write (gold § 2). This run replaced ${list.length} anyway, through the operator door\n` +
    `\`--refreeze ${ws.join(",")} --reason "<text>"\`. Each line below is one window's whole receipt: anyone holding\n` +
    `the previous commit can read exactly what stood there and exactly what replaced it.\n\n` +
    list.map((a) => `archives/acts/${a.window}.jsonl · old sha256 ${a.oldSha} · ${lineCount(a.was)} line(s) → new sha256 ${a.newSha} · ${a.lines} line(s)`).join("\n") +
    `\n\nreason: ${reason}\n\n` +
    `No window outside this list was touched. Every other differing archive still refuses.\n` +
    `window cursor ${d.windowCursor} · acts cursor ${d.cursors.acts_cursor}\n\nWritten by ${TOOL}.`;
}

/**
 * THE DECLARED RE-FREEZE'S RECEIPT. The declaration ids and their reasons ride
 * the first line; each window's two sha256s and the ids that explained it are
 * in the body, so the commit is still the whole receipt.
 */
export function declaredRefreezeSection(list, declarations) {
  const ids = [...new Set(list.flatMap((a) => a.declarations))];
  const decl = new Map(declarations.map((d) => [d.id, d]));
  return {
    head: `notary: refreeze ${list.length} archive(s) (${list.map((a) => a.window).join(", ")}) as declared — ` +
      ids.map((id) => `${id}: ${decl.get(id)?.reason ?? "?"}`).join("; "),
    body: `Re-frozen as DECLARED in world2/schema/REFREEZES.json: each window's difference verified as the named class(es).\n` +
      list.map((a) => `archives/acts/${a.window}.jsonl · ${a.declarations.join(" + ")} · old sha256 ${a.oldSha} · ${lineCount(a.was)} line(s) → new sha256 ${a.newSha} · ${a.lines} line(s)`).join("\n") +
      `\n\n` + ids.map((id) => { const d = decl.get(id) ?? {}; return `${id} (${d.class}${d.field ? ` ${d.field}` : ""}) — go: ${d.go}`; }).join("\n") +
      `\nConsumed once: recorded in ${CONSUMED_FILE}.`,
  };
}

/**
 * `--refreeze <n> --reason "<text>"`, read off argv. `<n>` may also be a LIST —
 * `154,155` or a range `154-172`, mixed — which returns an array of windows. Pure, so the refusal is
 * testable without a database — and validated BEFORE the pen connects, so
 * "--refreeze without --reason" exits 2 for the reason it names and not because
 * some environment variable happened to be missing first.
 */
export function parseRefreeze(argv) {
  const i = argv.indexOf("--refreeze");
  if (i === -1) return { refreeze: null, reason: null };
  const raw = argv[i + 1];
  const bad = () => new Cannot(`--refreeze wants a window NUMBER, or a list of them (154,155 or 154-172): got ${JSON.stringify(raw ?? null)}. Usage: --refreeze <n> --reason "<text>".`);
  if (raw === undefined || String(raw).startsWith("--")) throw bad();
  let n;
  if (/^\d+$/.test(String(raw))) n = Number(raw);
  else if (/^\d+(-\d+)?(,\d+(-\d+)?)+$|^\d+-\d+$/.test(String(raw))) {
    const set = new Set();
    for (const part of String(raw).split(",")) {
      const [lo, hi] = part.split("-").map(Number);
      if (hi !== undefined && hi < lo) throw bad();
      for (let w = lo; w <= (hi ?? lo); w++) set.add(w);
    }
    n = [...set].sort((a, b) => a - b);
  } else throw bad();
  const j = argv.indexOf("--reason");
  const reason = j === -1 ? "" : String(argv[j + 1] ?? "").trim();
  if (!reason || reason.startsWith("--")) {
    throw new Cannot(
      `--refreeze ${Array.isArray(n) ? n.join(",") : n} needs --reason "<text>". Replacing a frozen archive is the one write this pen makes ` +
      `that a human must own, and the reason goes on the commit's first line beside both sha256s. Refusing without one.`);
  }
  return { refreeze: n, reason };
}

/** Full re-render of the marks tree, including removing files no row derives. */
export function writeMarks(target, rendered, { dryRun }) {
  const wanted = new Map(rendered.map((r) => [r.path, r.bytes]));
  const root = path.join(target, "WORLD2", "marks");
  let written = 0, unchanged = 0;
  const removed = [];

  if (existsSync(root)) {
    const walk = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        const rel = path.relative(target, full).split(path.sep).join("/");
        if (!wanted.has(rel)) removed.push(rel);
      }
    };
    walk(root);
  }

  for (const [rel, bytes] of wanted) {
    const full = path.join(target, rel);
    if (existsSync(full) && readFileSync(full, "utf8") === bytes) { unchanged++; continue; }
    written++;
    if (dryRun) continue;
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, bytes);
  }
  if (!dryRun) for (const rel of removed) rmSync(path.join(target, rel), { force: true });
  return { written, unchanged, removed };
}

export async function runExport(client, { target, dryRun, allowDetached, now = Date.now(), refreeze = null, reason = null, manifestText = null }) {
  assertUsableTarget(target, { allowDetached });
  const d = await derive(client, { now });

  const consumedPath = path.join(target, CONSUMED_FILE);
  const { declarations, consumed } = loadDeclarations(
    manifestText ?? (existsSync(REFREEZES_MANIFEST) ? readFileSync(REFREEZES_MANIFEST, "utf8") : '{"declarations":[]}'),
    existsSync(consumedPath) ? readFileSync(consumedPath, "utf8") : null);
  const { plan, findings } = checkArchives(target, d.archives, { refreeze, declared: declarations });
  const declaredPlan = plan.filter((a) => a.action === "refreeze-declared");
  if (findings.length) throw new Red(`the append-only archive lane refuses this run`, findings);

  // A door that silently does nothing is not a door. If the operator named a
  // window, that window must actually be a differing archive — otherwise the
  // run would report a refreeze it never made.
  const refrozen = plan.filter((a) => a.action === "refreeze");
  // A LIST (2026-09-28): every window it names must be replaced, or the run
  // refuses — a door that quietly did half of what it was told is not a door.
  if (Array.isArray(refreeze) && refrozen.length !== refreeze.length) {
    const done = new Set(refrozen.map((a) => Number(a.window)));
    const idle = refreeze.filter((w) => !done.has(Number(w)));
    throw new Cannot(`--refreeze names ${idle.length} window(s) with nothing to replace: ${idle.join(", ")}. ` +
      `Each named window must be a closed, differing archive; name only those, or refreeze them one by one to read why.`);
  }
  if (refreeze !== null && !refrozen.length) {
    const held = d.held.find((h) => h.id === Number(refreeze));
    throw new Cannot(
      `--refreeze ${refreeze} has nothing to replace. ` +
      (held ? `Window ${refreeze} is HELD BACK: ${heldWindowLine(held)}. Refreeze it after its ferry sails.`
            : !d.archives.some((a) => Number(a.window) === Number(refreeze))
              ? `No CLOSED window ${refreeze} is derived by this database.`
              : `archives/acts/${refreeze}.jsonl either does not exist yet, or already reproduces exactly — there is no differing archive to replace.`));
  }

  const cert = certification({ ...d, exportedAt: new Date().toISOString() });
  const tag = tagName(d);

  // An existing tag for the same cursors means this state is already certified.
  // Idempotent — but only after checking that what it certified is what this run
  // would certify. A tag that says something else about the same cursors is the
  // loudest finding this pen can make.
  const tagged = gitOk(target, ["rev-parse", "--verify", `refs/tags/${tag}`]);
  if (tagged) {
    const message = git(target, ["for-each-ref", "--format=%(contents)", `refs/tags/${tag}`]);
    let existing = null;
    try { existing = JSON.parse(message.slice(message.indexOf("{"), message.lastIndexOf("}") + 1)); } catch { /* named below */ }
    if (!existing) {
      throw new Red(`tag ${tag} exists but its message does not carry a readable certification`, [message.slice(0, 400)]);
    }
    if (certificationSubstance(existing) !== certificationSubstance(cert)) {
      const x = excerpt(certificationSubstance(existing), certificationSubstance(cert));
      throw new Red(`tag ${tag} certifies a DIFFERENT state than this database now derives`, [
        `first divergence at char ${x.at}\n    the tag says: ${x.a}\n    the DB derives: ${x.b}\n` +
        `    Same cursors, different substance: either history moved beneath a closed window, or this tag was written from another database.`]);
    }
  }

  // WHAT WOULD CHANGE — asked before anything is written, because "already
  // certified" is a claim about the TARGET'S FILES and not about the tag.
  // A tag proves this state was certified once; it does not prove the checkout
  // still holds it. (Found while proving the append-only lane: delete an archive
  // from a tagged target and the pen said "nothing to do" and left the hole.)
  const certPath = path.join(target, CERT_FILE);
  let certChanged = true;
  if (existsSync(certPath)) {
    try { certChanged = certificationSubstance(JSON.parse(readFileSync(certPath, "utf8"))) !== certificationSubstance(cert); }
    catch { certChanged = true; }
  }
  const preview = writeMarks(target, d.rendered, { dryRun: true });
  const wouldChange = certChanged || preview.written > 0 || preview.removed.length > 0
    || plan.some((a) => a.action === "write" || a.action === "refreeze" || a.action === "refreeze-declared");

  if (tagged && !wouldChange) {
    return { status: "already-certified", tag, cert, derived: d, wrote: null };
  }

  const marksResult = writeMarks(target, d.rendered, { dryRun });
  for (const a of plan) {
    if ((a.action !== "write" && a.action !== "refreeze" && a.action !== "refreeze-declared") || dryRun) continue;
    const full = path.join(target, a.path);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, a.bytes);
  }
  if (!dryRun) writeFileSync(certPath, writeCert(cert));
  if (!dryRun && declaredPlan.length) writeFileSync(consumedPath, consumeDeclarations(consumed, plan, cert.exported_at ?? new Date().toISOString()));

  if (dryRun) return { status: tagged ? "dry-run-repair" : "dry-run", tag, cert, derived: d, wrote: { marks: marksResult, archives: plan } };

  // ONE commit carries all three surfaces. Only this pen's own paths are staged:
  // whatever else the caller keeps in this checkout is none of the notary's
  // business, and sweeping it in would make the certification a claim about
  // files the certification does not describe.
  git(target, ["add", "--", CERT_FILE, "archives", "WORLD2/marks", ...(declaredPlan.length ? [CONSUMED_FILE] : [])]);
  const declaredMsg = declaredPlan.length ? declaredRefreezeSection(declaredPlan, declarations) : null;
  if (git(target, ["diff", "--cached", "--name-only"]).length) {
    git(target, ["commit", "-m", declaredMsg && !refrozen.length
      ? `${declaredMsg.head}\n\n${declaredMsg.body}\n\nwindow cursor ${d.windowCursor} · acts cursor ${d.cursors.acts_cursor}\n\nWritten by ${TOOL}.`
      : declaredMsg
      ? `${refrozen.length > 1 ? refreezeManyCommitMessage(refrozen, reason, d) : refreezeCommitMessage(refrozen[0], reason, d)}\n\n${declaredMsg.head}\n${declaredMsg.body}`
      : refrozen.length > 1
      ? refreezeManyCommitMessage(refrozen, reason, d)
      : refrozen.length
      ? refreezeCommitMessage(refrozen[0], reason, d)
      : tagged
      ? `notary: restore the state ${tag} certifies\n\nThe tag stood; the checkout no longer held what it certifies. ` +
        `Re-derived and rewritten — the tag is unchanged.\n\nWritten by ${TOOL}.`
      : `notary: certify window ${d.windowCursor}, acts ${d.cursors.acts_cursor}\n\n` +
        `${d.archives.length} archived window(s), ${d.cursors.marks_count} mark bodies.\n` +
        `law ${d.pins.law_sha}\ntown ${d.pins.town_sha}\n\nWritten by ${TOOL}.`], { ident: true });
  }
  const commit = git(target, ["rev-parse", "HEAD"]);
  // The tag is written once and never moved. A notary that re-pointed a
  // certification it had already signed would be signing twice for one moment.
  if (!tagged) git(target, ["tag", "-a", tag, "-F", "-"], { ident: true, input: writeCert(cert) });

  return { status: tagged ? "restored" : "certified", tag, commit, cert, derived: d, wrote: { marks: marksResult, archives: plan } };
}

// ── mode: verify ─────────────────────────────────────────────────────────────

// Deterministic sampling: evenly spaced across the file, so two verifications of
// the same target check the same lines and a green is reproducible. (Random
// sampling would make a green mean "some lines, once".)
export function sampleIndexes(n, want) {
  if (n <= want) return Array.from({ length: n }, (_, i) => i);
  const out = [];
  for (let k = 0; k < want; k++) out.push(Math.floor((k * n) / want));
  return out;
}

/**
 * --verify: no DB writes ever, and it proves the READ side too. Three questions:
 *
 *   1. does the certification on disk say what this database now derives?
 *   2. do the rendered mark files match what this database now renders?
 *   3. does a sample of ARCHIVED LINES still agree with the acts rows they came
 *      from — read back from `acts` by id, one row at a time?
 *
 * (3) is the one that makes this more than a re-run of the exporter: the digest
 * would catch a mangled archive too, but only as "the sha moved". Reading the
 * row back names the act, the field, and both spellings.
 */
async function runVerify(client, { target, spotCheck, now = Date.now() }) {
  assertUsableTarget(target, { allowDetached: true });
  const certPath = path.join(target, CERT_FILE);
  if (!existsSync(certPath)) throw new Cannot(`${target} holds no ${CERT_FILE} — there is nothing to verify. (Exit 2: a verifier that checked nothing must not report green.)`);

  let onDisk;
  try { onDisk = JSON.parse(readFileSync(certPath, "utf8")); }
  catch (e) { throw new Cannot(`${CERT_FILE} is not readable JSON: ${e.message}`); }

  const d = await derive(client, { now });
  const findings = [];

  // 1 · the certification
  const derivedCert = certification({ ...d, exportedAt: onDisk.exported_at ?? null });
  if (certificationSubstance(onDisk) !== certificationSubstance(derivedCert)) {
    for (const k of Object.keys(derivedCert)) {
      if (k === "exported_at") continue;
      const a = canonical(onDisk[k]), b = canonical(derivedCert[k]);
      if (a === b) continue;
      const x = excerpt(a, b);
      findings.push(`${CERT_FILE} DIFFERS at ${k} · first divergence at char ${x.at}\n    on disk: ${x.a}\n    DB derives: ${x.b}`);
    }
    for (const k of Object.keys(onDisk)) {
      if (k in derivedCert) continue;
      findings.push(`${CERT_FILE} carries a field the DB derives nothing for: ${k}`);
    }
  }

  // 2 · the rendered bodies, named file by file
  const want = new Map(d.rendered.map((r) => [r.path, r.bytes]));
  for (const [rel, bytes] of want) {
    const full = path.join(target, rel);
    if (!existsSync(full)) { findings.push(`mark render MISSING on disk: ${rel}`); continue; }
    const have = readFileSync(full, "utf8");
    if (have === bytes) continue;
    const x = excerpt(have, bytes);
    findings.push(`mark render DIFFERS: ${rel} · first divergence at char ${x.at}\n    on disk: ${x.a}\n    DB renders: ${x.b}`);
  }

  // 3 · the archive FILES themselves, then a sample of their lines read back
  //
  // Both, and the order matters. The certification comparison above is
  // DB-derived-vs-certified: it never opens an archive, so on its own it would
  // pass over a hand-edited line entirely (found exactly that way — mangle line
  // 97 and only the sampled read-back noticed). The whole-file compare is
  // therefore the DETECTOR: every byte of every archive, against what the
  // database derives now, plus the sha the certification recorded — the same
  // computation a stranger with a clone can run. The spot-check is the RECEIPT:
  // it names the act, the field and both spellings, which a moved digest cannot.
  const certSha = new Map((onDisk.archives ?? []).map((a) => [Number(a.window), a.sha256]));
  let checked = 0;
  for (const a of d.archives) {
    const full = path.join(target, a.path);
    if (!existsSync(full)) { findings.push(`archive MISSING on disk: ${a.path} (${a.lines} act(s) the DB puts in window ${a.window})`); continue; }
    const bytes = readFileSync(full, "utf8");
    const lines = bytes.replace(/\n$/, "");
    const arr = lines.length ? lines.split("\n") : [];
    if (arr.length !== a.lines) findings.push(`archive ${a.path}: ${arr.length} line(s) on disk, ${a.lines} derived from acts`);
    if (bytes !== a.bytes) {
      const wl = a.bytes.replace(/\n$/, "").split("\n");
      let at = arr.findIndex((l, i) => l !== wl[i]);
      if (at === -1) at = Math.min(arr.length, wl.length);
      findings.push(`archive ${a.path} does not match what the database derives — first divergence at line ${at + 1}`);
    }
    if (certSha.has(a.window) && certSha.get(a.window) !== sha256(bytes)) {
      findings.push(
        `archive ${a.path} does not match the sha ${CERT_FILE} certifies for window ${a.window} ` +
        `(certified ${certSha.get(a.window)}, on disk ${sha256(bytes)}). This is the check a clone can run without a database.`);
    }
    for (const i of sampleIndexes(arr.length, spotCheck)) {
      let parsed;
      try { parsed = JSON.parse(arr[i]); }
      catch { findings.push(`archive ${a.path} line ${i + 1} is not JSON`); continue; }
      const { rows } = await client.query("SELECT * FROM acts WHERE id = $1", [parsed.id]);
      checked++;
      if (rows.length !== 1) { findings.push(`archive ${a.path} line ${i + 1} claims acts.id ${parsed.id}, which the log does not hold`); continue; }
      const fresh = archiveLine(rows[0]);
      if (fresh === arr[i]) continue;
      const x = excerpt(arr[i], fresh);
      findings.push(`archive ${a.path} line ${i + 1} (acts.id ${parsed.id}) disagrees with its row · first divergence at char ${x.at}\n    archived: ${x.a}\n    acts row: ${x.b}`);
    }
  }

  // An archive nobody derives is as much a finding as one that went missing —
  // a forged window would otherwise sit in the durability lane unremarked.
  const acts = path.join(target, "archives", "acts");
  if (existsSync(acts)) {
    const derived = new Set(d.archives.map((a) => path.posix.basename(a.path)));
    // A file for a HELD window is a different finding, and saying so in the
    // right words is the whole difference between "somebody forged a window"
    // and "this pen froze one early" — which is the bug POS-189 is.
    const heldByName = new Map(d.held.map((h) => [`${h.id}.jsonl`, h]));
    for (const name of readdirSync(acts)) {
      if (derived.has(name)) continue;
      const h = heldByName.get(name);
      findings.push(h
        ? `archives/acts/${name} was frozen before its ferry sailed — ${heldWindowLine(h)}. ` +
          `It is short by construction and every later run will refuse it: the way through is --refreeze ${h.id} --reason "<text>" once ferry ${h.ferry} has sailed.`
        : `archives/acts/${name} is on disk but no CLOSED window derives it`);
    }
  }

  return { findings, checked, derived: d, cert: onDisk };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const argOf = (name) => { const i = process.argv.indexOf(name); return i !== -1 ? process.argv[i + 1] : null; };
const has = (name) => process.argv.includes(name);

const USAGE = `usage:
  WORLD2_PG_URL=postgres://snapshot_reader:…@host/world2_dev \\
    node ${TOOL} --target <git-checkout> [--dry-run] [--allow-detached] [--json]
    node ${TOOL} --verify <git-checkout> [--spot-check N] [--json]

the operator door, for ONE archive that the database no longer reproduces:
    node ${TOOL} --target <git-checkout> --refreeze <window> --reason "<text>"

The caller supplies the checkout; this pen never creates, fetches or pushes one.
exit 0 green · 1 RED (drift or refusal) · 2 cannot run`;

async function connect() {
  if (!process.env.WORLD2_PG_URL) throw new Cannot(`WORLD2_PG_URL is not set.\n${USAGE}`);
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: process.env.WORLD2_PG_URL });
  await client.connect();
  const who = (await client.query("SELECT current_user AS u")).rows[0].u;
  if (WRITING_ROLES.has(who)) {
    await client.end();
    throw new Cannot(
      `refusing to run as '${who}', which holds write grants. The notary reads the database and writes the repo — ` +
      `"reads DB, writes notary certifications + event archives into git, never writes the DB" (gold §3 rule 2). ` +
      `Connect as snapshot_reader (PG_SNAPSHOT_READER_PASSWORD).`);
  }
  return { client, who };
}

async function main() {
  const doVerify = has("--verify");
  const target = doVerify ? argOf("--verify") : argOf("--target");
  if (!target || has("--help") || has("-h")) { console.error(USAGE); process.exit(2); }
  const asJson = has("--json");
  // Read and validated BEFORE connect(): a refusal that depends on which error
  // the program happened to reach first is not a rule, it is an accident.
  const { refreeze, reason } = parseRefreeze(process.argv);
  if (refreeze !== null && doVerify) {
    throw new Cannot("--refreeze is a WRITE; --verify never writes. Run the door against --target.");
  }

  const { client, who } = await connect();
  let result;
  try {
    result = doVerify
      ? await runVerify(client, { target, spotCheck: Number(argOf("--spot-check") ?? 25) })
      : await runExport(client, { target, dryRun: has("--dry-run"), allowDetached: has("--allow-detached"), refreeze, reason });
  } finally { await client.end(); }

  if (doVerify) {
    const { findings, checked, derived, cert } = result;
    if (asJson) console.log(JSON.stringify({ mode: "verify", green: !findings.length, checked, findings }, null, 2));
    else if (findings.length) {
      console.log(`RED · ${target} — ${findings.length} finding(s) (${checked} archived line(s) read back against acts)`);
      for (const f of findings) console.log(`  - ${f}`);
    } else {
      console.log(`GREEN · ${target} certifies what the database derives`);
      console.log(`  window cursor ${derived.windowCursor} · acts cursor ${derived.cursors.acts_cursor} · ${derived.cursors.marks_count} marks`);
      console.log(`  ${derived.archives.length} archive(s), ${checked} line(s) read back against their acts rows`);
      for (const h of derived.held) console.log(`  HELD BACK · ${heldWindowLine(h)}`);
      console.log(`  marks_content_sha ${cert.marks_content_sha}`);
    }
    process.exit(findings.length ? 1 : 0);
  }

  const { status, tag, commit, cert, derived, wrote } = result;
  if (asJson) {
    console.log(JSON.stringify({
      mode: "export", status, tag, commit,
      held: derived.held.map((h) => ({ window: h.id, ferry: h.ferry, sails_at: h.sailsAt })),
      refrozen: (wrote?.archives ?? []).filter((a) => a.action === "refreeze")
        .map((a) => ({ window: a.window, old_sha256: a.oldSha, new_sha256: a.newSha, reason })),
      refrozen_declared: (wrote?.archives ?? []).filter((a) => a.action === "refreeze-declared")
        .map((a) => ({ window: a.window, old_sha256: a.oldSha, new_sha256: a.newSha, declarations: a.declarations })),
      certification: cert,
    }, null, 2));
    process.exit(0);
  }
  if (status === "already-certified") {
    console.log(`GREEN · nothing new to certify — ${tag} already stands, and it certifies exactly what the database derives`);
    process.exit(0);
  }
  const HEAD = {
    "certified": ["CERTIFIED", "certified"],
    "restored": ["RESTORED", "rewrote the state certified by"],
    "dry-run": ["DRY RUN", "would certify"],
    "dry-run-repair": ["DRY RUN", "would rewrite the state certified by"],
  }[status];
  console.log(`${HEAD[0]} · ${HEAD[1]} ${tag}${commit ? ` at ${commit}` : ""} (read as ${who})`);
  console.log(`  windows closed ${derived.windows.map((w) => w.id).join(", ")} · acts cursor ${derived.cursors.acts_cursor} · marks ${derived.cursors.marks_count}`);
  for (const a of wrote.archives) {
    console.log(`  archives/acts/${a.window}.jsonl — ${a.lines} act(s) [${a.action}]` +
      (a.action === "refreeze" ? `\n      old sha256 ${a.oldSha}\n      new sha256 ${a.newSha}\n      reason: ${reason}` : "") +
      (a.action === "refreeze-declared" ? `\n      old sha256 ${a.oldSha}\n      new sha256 ${a.newSha}\n      declared: ${a.declarations.join(" + ")}` : ""));
  }
  // The two reasons an act has no archive, said apart. "Their window has not
  // closed" was the ONLY sentence this pen had, and it was the wrong one for
  // the newest window every single run (POS-189).
  for (const h of derived.held) console.log(`  HELD BACK · ${heldWindowLine(h)}`);
  if (derived.heldBack) console.log(`  ${derived.heldBack} act(s) held back: no archive owns them yet — their window has not closed, or has closed but its ferry has not sailed`);
  console.log(`  marks: ${wrote.marks.written} written, ${wrote.marks.unchanged} unchanged${wrote.marks.removed.length ? `, ${wrote.marks.removed.length} removed` : ""}`);
  console.log(`  marks_content_sha ${cert.marks_content_sha}`);
  console.log(`  archives_sha ${cert.archives_sha}`);
  console.log(`  law ${cert.law_sha} · town ${cert.town_sha}`);
  process.exit(0);
}

// ── entry guard ──────────────────────────────────────────────────────────────
// The junction lesson (2026-09-05, HQ memory `junctions-defeat-main-guards`):
// `pathToFileURL(process.argv[1]).href === import.meta.url` is FALSE when the
// entry path reaches this file through a Windows junction — the ESM loader
// realpaths the entry, argv[1] is not — so the tool exits 0 having done nothing.
// Compare real paths (world2/tools/await-clearing.mjs's idiom); the URL compare is
// only the fallback for an argv[1] that cannot be realpath'd. The office's
// test/cli-guard.test.mjs imports this file and spawns it through a junction.
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) {
  main().catch((e) => {
    if (e instanceof Red) {
      console.error(`RED · ${e.message}`);
      for (const f of e.findings) console.error(`  - ${f}`);
      process.exit(1);
    }
    if (e instanceof Cannot) { console.error(`CANNOT RUN · ${e.message}`); process.exit(2); }
    console.error(String(e?.stack ?? e));
    process.exit(2);
  });
}
