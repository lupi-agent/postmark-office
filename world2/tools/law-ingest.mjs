#!/usr/bin/env node
// law-ingest.mjs — the `law_ingester` pen, repo → DB, mechanical.
//
// THE LAW THIS IMPLEMENTS (gold plan postmark-world-2.md § 3, anti-rebake rule 2,
// pen 3), verbatim:
//
//   "`law_ingester` (REPLACED `review_publisher`, Keemin-ruled 2026-08-28: law is
//    REPO-FIRST, exported to DB — never authored in the DB): a MECHANICAL sync
//    fired on a law merge — parses LOGOS/class marks into `law_projection`,
//    stamping every row with the law commit sha. No judgment, no schedule."
//
// ── THE STATELESS CONTRACT (gold § 2, the git-facing reuse line) ─────────────
//
//   "The two new sync jobs (law_ingester, snapshot_exporter) are built small and
//    STATELESS — GitHub-API commits or fresh shallow clone per run, discarded
//    after; NO long-lived clones on the box, which makes the month's entire
//    clone-pathology class (wedged rebases, ownership poisonings, stash/upstream
//    traps, ff-freezes) unrepresentable."
//
// So this tool:
//   · takes a checkout path as an ARGUMENT — it does not own, create, fetch,
//     rebase, or clean one;
//   · NEVER writes to that checkout, and never runs a git command that mutates
//     it (the only git it runs is `rev-parse HEAD`, to check the caller's `--sha`);
//   · keeps NO state between runs — every run is a full re-derivation of one sha,
//     and re-running the same sha is a no-op by construction (DELETE then INSERT
//     inside one transaction).
//
// The caller supplies a fresh or pinned checkout and disposes of it. That is the
// whole of the seam: if the checkout is wrong, the `--sha` guard refuses; if the
// DB is wrong, the standing falsifier (falsifier-projection-equality.mjs) reds.
//
// ── REUSE, NOT RE-IMPLEMENTATION (gold § 2: "reuse the READERS") ─────────────
//
// Every parse below is the world repo's OWN proven parser, imported live out of
// the checkout that is being ingested — so the projection is by construction
// derived by the same code the lint, the fold and the hydrator use, at the sha
// being ingested. Nothing here re-implements a parse:
//
//   loadMarks / parseRecord   world  tools/marks-fold.mjs   the marks register reader
//                                    (world-hydrate.mjs imports the identical pair)
//   termsAt / entryLawOf      world  tools/enter-exit.mjs   the threshold entry law
//   actionEntriesOf           office src/world-store.mjs    what a class GRANTS —
//                                    the door's own reader, so the projection says
//                                    exactly what the door says (a static in-repo
//                                    import; this file ships in the office)
//
// The ONE exception is documented at `isClassDeclaration` below, which the world
// keeps private to its lint. It is vendored as four lines with its source named.
//
// ── USAGE ───────────────────────────────────────────────────────────────────
//
//   PGHOST=localhost PGDATABASE=world2_dev PGUSER=law_ingester PGPASSWORD=… \
//     node world2/tools/law-ingest.mjs --law-repo /tmp/world-at-sha --sha <sha>
//
//   --dry-run   derive and print the row census; touch no database
//   --json      machine-readable summary on stdout

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, realpathSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

import { actionEntriesOf } from "../../src/world-store.mjs";

export const LAW_REPO_KEY = "world-law"; // projection_heads.repo for this pen

// ── the checkout's own parsers, imported from the checkout ───────────────────
// A dynamic import off a path argument is what makes "reuse the readers" literal
// rather than aspirational: the code that parses sha X is the code that shipped
// at sha X. A cross-repo static import is impossible (different package roots),
// and a copy would be a twin that drifts silently — the exact failure class the
// gold plan's rule 5 exists to forbid.
const toolUrl = (repo, file) => pathToFileURL(join(resolve(repo), "tools", file)).href;

async function readersOf(lawRepo) {
  // TWO-NAME FALLBACK (the rename-orphans class, 4th instance, found by the
  // seed jetto 2026-08-28): the entry-law reader was tools/thresholds.mjs until
  // world e14a0bd7 renamed it tools/enter-exit.mjs — AFTER the frozen
  // sandbox/seed tag (52c281b8). Both export the same termsAt/entryLawOf.
  // "Import the reader from the checkout" is only sha-portable as far back as
  // the reader's name goes, so a historical sha gets the name of its own day.
  const entryLawReader = async () => {
    try { return await import(toolUrl(lawRepo, "enter-exit.mjs")); }
    catch (err) {
      if (err?.code !== "ERR_MODULE_NOT_FOUND") throw err;
      return import(toolUrl(lawRepo, "thresholds.mjs"));
    }
  };
  const [fold, enterExit] = await Promise.all([
    import(toolUrl(lawRepo, "marks-fold.mjs")),
    entryLawReader(),
  ]);
  return { loadMarks: fold.loadMarks, termsAt: enterExit.termsAt, entryLawOf: enterExit.entryLawOf };
}

// ── the ONE vendored predicate ───────────────────────────────────────────────
//
// VENDOR SHIM. Source: keeminlee/postmark-world `tools/mark-lint.mjs` lines
// 114–124 at world commit c701988f9ff937661297a8acc87a48925ba3b37f (blob
// 68b1e35a67522cb03488cd8d8b940231d769f0c5), where it is `standsInTheWorks` +
// `isClassDeclaration`. The world does not export it — it is a `const` inside a
// CLI module that loads the whole marks tree at import — so it cannot be reached
// the way the other readers are, and this is the four-line copy the gold plan's
// reuse line allows with its source named.
//
// The law it encodes (LOGOS/classes.md § Instantiation, as the lint states it):
// a class-carrying mark standing in the Keeping Works DECLARES its class;
// anywhere else it is an INSTANCE. Ancestry-walked, never direct parent — a
// definition nested under another class mark (household/human) is still of the
// works. The hydrator draws the identical line at its `standsInWorks`.
//
// IF THIS DRIFTS: the equality falsifier will NOT catch it (falsifier and
// ingester share this function by design, so it can only catch DB drift). What
// catches it is the world's own lint disagreeing with this projection about the
// roster — a cross-check worth owning when the class roster next changes shape.
const KEEPING_WORKS_ID = "the-town/the-keeping-works";
const standsInTheWorks = (rec, byId) => {
  let cur = rec, hops = 0;
  while (cur && hops++ < 64) {
    if (cur.id === KEEPING_WORKS_ID) return true;
    cur = cur._parentMarkId ? byId.get(cur._parentMarkId) : null;
  }
  return false;
};
const isClassDeclaration = (m, byId) =>
  m.by === "the-town" && m.tier === "constitution" && m.class !== undefined && standsInTheWorks(m, byId);

// A mark record carries `_dir` as an ABSOLUTE path on the machine that parsed it.
// Left in `data` it would make the projection machine-dependent — two honest
// ingests of the same sha from two checkouts would compare unequal, and the
// standing falsifier would red on a difference that is not drift. So `_dir` is
// dropped from `data` and its repo-relative form becomes the `path` COLUMN,
// which is the column's whole job. Everything else the parser produced rides
// through untouched (the brief's rule: `data` is the parser's own output).
const relPath = (repo, abs) => relative(resolve(repo), abs).replace(/\\/g, "/");
// ONE SPELLING OF `ambient`, NORMALISED AT THE PEN (2026-09-04, the B2 lane's
// finding, taken as the runbook's own item). The world's loader
// (marks-fold.mjs § parseRecord) "coerces objects, arrays and numbers but has
// NO boolean case", so `ambient: true` in a class mark reaches here as the
// STRING "true"; the sqlite hydrator normalises it (world-hydrate.mjs:457) and
// this ingester did not, so `nodes` held a boolean and `law_projection` held a
// string, and the first cut of the 2.0 apex read every ambient class as
// non-ambient. The hydrator's own pair, applied once, here — never truthiness:
// `1`, `"yes"`, `"TRUE"` stay what they were, because one spelling is the rule.
/**
 * HOUSEHOLD KEY → GITHUB LOGIN, where the registry actually states one.
 *
 * `WORLD/households.json`'s `logins` map is keyed by LOGIN and valued by
 * HOUSEHOLD KEY. Inverting it reaches a handle's login, which is what an
 * identity row wants. Two things make that inversion unsound, and both resolve
 * to NULL rather than to a pick, because a fabricated identity in the law store
 * is worse than a missing one.
 *
 * 1. SEVERAL LOGINS ON ONE KEY. A household aggregates a human's agents, so two
 *    logins on one key make "this handle's login" a guess. (Measured against the
 *    live file 2026-08-28: 0 of 73 keys carried more than one, so this guard
 *    changed nothing then and forecloses the drift.)
 *
 * 2. A KEY WHOSE ONE "LOGIN" IS NOT A LOGIN — added 2026-09-09, and it is not
 *    hypothetical. Since that day the export deliberately binds more than
 *    logins: every household key no login binds is planted in this same map
 *    under THE SKETCHBOOK NAME the key carries, so the authorship wall can read
 *    a branch name through it (tools/world-households-export.mjs § THE SECOND
 *    KEY). So `logins` now holds rows like `"cadaeic.space" -> "hh:cadaeic.space"`,
 *    and inverting them hands back a house's name as somebody's GitHub login.
 *    Measured against the refreshed registry: EIGHT handles — argos, arky,
 *    errant, nfh, solin-sunraven, vertas-marginalia, yuanqu, zeno-at-the-seam.
 *
 * ONLY `gh:<digits>` KEYS ARE READ HERE. Their binding came from the town's own
 * pins file, so it is a login by provenance. `login:<name>` keys are a login by
 * construction too, but the caller reads those straight off the key and never
 * needs this map. Every other shape — `hh:<house>`, `solo:<handle>` — is a
 * sketchbook name, and gets nothing.
 */
export function githubLoginByHouseholdKey(logins) {
  const byKey = new Map();
  for (const [login, key] of Object.entries(logins ?? {})) {
    const k = String(key);
    if (!/^gh:\d+$/.test(k)) continue;      // not a credential key → not a login
    byKey.set(k, [...(byKey.get(k) ?? []), String(login)]);
  }
  return new Map([...byKey].filter(([, v]) => v.length === 1).map(([k, v]) => [k, v[0]]));
}

export const recordData = (rec) => {
  const { _dir, ...rest } = rec;
  if (Object.prototype.hasOwnProperty.call(rest, "ambient")) {
    rest.ambient = rest.ambient === true || rest.ambient === "true" ? true
      : rest.ambient === false || rest.ambient === "false" ? false
      : rest.ambient;
  }
  return rest;
};

// THE STORAGE ROUND-TRIP, APPLIED AT DERIVATION. Every row's `data` goes through
// this before it is either stored or compared, so what the deriver returns is
// exactly what `jsonb` will hold — one value, not two shapes of one value.
//
// This is not tidiness; it is what makes the equality falsifier's question
// answerable. `JSON.stringify` DROPS a key whose value is `undefined`, and a
// mark record has several (`_explicitParent` on any mark that authored no
// parent; both members of `_stray` on any mark that carried no legacy field).
// So the in-memory row had keys the stored row did not, and the standing
// falsifier's FIRST run against the live dev DB reported 129 class rows as
// drift — every one a false alarm about a difference the database never had a
// choice about. A guard whose first real firing is a false positive is a guard
// people turn off, so the asymmetry is removed at the source rather than
// papered over in the comparator.
const jsonSafe = (v) => JSON.parse(JSON.stringify(v ?? null));

/**
 * Derive every `law_projection` row and every `identities` row for one checkout.
 *
 * PURE with respect to the checkout and the database: it reads files and returns
 * rows. Both the ingester and the standing falsifier call THIS — one derivation,
 * so an equality check can only ever be about the database, never about two
 * parsers that fell out of step.
 *
 * Rows come back sorted by (kind, key) so any two runs produce byte-identical
 * order, which is what lets the falsifier diff positionally and cheaply.
 */
export async function deriveLaw({ lawRepo }) {
  const repo = resolve(lawRepo);
  const { loadMarks, termsAt } = await readersOf(repo);

  const marksDir = join(repo, "WORLD", "marks");
  if (!existsSync(marksDir)) throw new Error(`no WORLD/marks under ${repo} — is this a world-law checkout?`);
  const marks = loadMarks(marksDir);
  const byId = new Map(marks.map((m) => [m.id, m]));

  const rows = [];
  const push = (kind, path, key, data) => rows.push({ kind, path, key, data: jsonSafe(data) });

  // ── kind: class ────────────────────────────────────────────────────────────
  // One row per class the law DECLARES, keyed by the class name, carrying the
  // whole record the world's own loader built (dials, implements, actions,
  // extends, version, body — the fields that make a class mark law).
  const declarations = marks.filter((m) => isClassDeclaration(m, byId));
  for (const m of declarations) {
    push("class", relPath(repo, join(m._dir, "mark.md")), String(m.class), recordData(m));
  }

  // ── kind: grant ────────────────────────────────────────────────────────────
  // "everything a class grants IS an action" (world-hydrate.mjs § the class
  // fields, on the 2026-08-15 rename of `affordances:` to `actions:`). A grant
  // is the (class, action) PAIR, which is why the pair is the row's key.
  //
  // READ BY THE DOOR'S OWN READER. An `actions:` entry is an OBJECT in the live
  // law — `{"action": "say", "residue": "the-town/say"}` — and the first cut of
  // this file assumed a bare string, which stringified twelve of resident's
  // grants to `[object Object]` and collided on the primary key. The fix is not
  // a better guess at the shape: it is `actionEntriesOf`, the office's ONE reader
  // of that field (src/world-store.mjs), which also carries the `for:` actor kind
  // ("`for:` absent means resident — today's intent made explicit, never a
  // guess") and reads both the pre- and post-rename spellings.
  //
  // A consequence worth stating: an entry the door cannot read — a legacy bare
  // string — yields NO grant here, because it grants nothing at the door either.
  // The projection says what the door says, including where the door says
  // nothing.
  for (const m of declarations) {
    const path = relPath(repo, join(m._dir, "mark.md"));
    for (const entry of actionEntriesOf({ props: m })) {
      push("grant", path, grantKey(m.class, entry),
        { class: String(m.class), ...entry, from: m.id });
    }
  }

  // ── kind: predicate ────────────────────────────────────────────────────────
  // A class's PREDICATE CHILDREN (POS-270, 2026-09-27). classes.md § the seam:
  // "Every dial is a predicate ... a number the law carries rides a predicate
  // child, never a frontmatter JSON". Say's and the doorstep's dials live there
  // since 2026-08-22, and the office's `dialNumber` reads them FIRST — so a
  // class read from this projection that carried only the class mark would
  // answer say's earshot from the fallback. Measured at S83: 51 of 155 classes
  // carry predicate children; every frontmatter `dials` already agrees.
  //
  // The same relation world-hydrate.mjs draws as a `describes` edge: a
  // non-geometric mark nested under the class mark (its `_parentMarkId`, the
  // loader's own), carrying a `slot`. Keyed by (class, slot), which is how the
  // door asks; `id` rides so `dialNode` can point at the node, not guess it.
  const isGeometric = (m) => m?.kind === "sited" || m?.kind === "parcel";
  const classOfId = new Map(declarations.map((m) => [m.id, String(m.class)]));
  for (const m of marks) {
    const klass = classOfId.get(m._parentMarkId);
    if (klass === undefined || isGeometric(m) || m.slot === undefined || m.slot === null) continue;
    push("predicate", relPath(repo, join(m._dir, "mark.md")), `${klass}/${m.slot}`,
      { class: klass, slot: m.slot, value: m.value ?? null, id: m.id });
  }

  // ── kind: threshold ────────────────────────────────────────────────────────
  // The entry law a mark answers at its threshold — `termsAt` is the world's own
  // reader and its return value IS the row's data ("what a walker reads AT the
  // threshold, before he crosses"). A mark that writes no `entry:` has no entry
  // law and answers the town's standing default, so it gets no row: law is an
  // exceptions ledger (enter-exit.mjs, atom 10), and a projection that spelled
  // out every silent mark's default would be asserting law nobody wrote.
  for (const m of marks) {
    const terms = termsAt(m);
    if (!terms) continue;
    push("threshold", relPath(repo, join(m._dir, "mark.md")), String(m.id), terms);
  }

  // ── kind: skeleton ─────────────────────────────────────────────────────────
  // "WORLD/skeleton.json (the map is law)" — census.md decision 1. One row per
  // TOP-LEVEL KEY of the document, so the rows use the document's own vocabulary
  // and nothing is invented; the whole file reassembles by building an object
  // from the rows, exactly and losslessly. Per-feature rows were considered and
  // refused: the real consumer (marks-fold's `fold({ terrain })`) wants the whole
  // document, so splitting `features` would be a normal form no reader asked for.
  const skeletonPath = join(repo, "WORLD", "skeleton.json");
  if (existsSync(skeletonPath)) {
    const skeleton = JSON.parse(readFileSync(skeletonPath, "utf8"));
    for (const [key, value] of Object.entries(skeleton)) {
      push("skeleton", "WORLD/skeleton.json", key, value);
    }
  }

  // ── kind: roster ───────────────────────────────────────────────────────────
  // "WORLD/households.json (roster is REVIEW-class)" — census.md decision 1. One
  // row per handle, carrying the file's own two statements about it: its
  // household key and its GitHub login where the file records one.
  const identities = [];
  const householdsPath = join(repo, "WORLD", "households.json");
  if (existsSync(householdsPath)) {
    const doc = JSON.parse(readFileSync(householdsPath, "utf8"));
    const households = doc.households ?? {};
    const logins = doc.logins ?? {};
    // `logins` is keyed by LOGIN and valued by HOUSEHOLD KEY — the file's own
    // shape. Inverting it reaches a handle's login, which is what an identity row
    // wants, but the inversion is only sound while a household key has exactly
    // ONE login: a household aggregates a human's agents, so two logins on one
    // key would make "this handle's login" a guess, and picking the first would
    // be a fabrication indistinguishable from a fact. Ambiguity therefore
    // resolves to null, not to an arbitrary pick. (Verified against the live
    // file 2026-08-28: 0 of 73 household keys carry more than one login, so this
    // guard changes nothing today and forecloses the drift.)
    //
    // ── AND THE SECOND GUARD: A KEY WHOSE ONE "LOGIN" IS NOT A LOGIN ──────────
    //                                                            (2026-09-09)
    //
    // The guard above asks whether a key carries SEVERAL logins. It never asked
    // whether the one it carries is a login at all, and since 2026-09-09 the
    // export deliberately binds more than logins: every household key no login
    // binds is planted in this same map under THE SKETCHBOOK NAME that key
    // carries, so the authorship wall can read a branch name through it
    // (tools/world-households-export.mjs § THE SECOND KEY).
    //
    // So `logins` now contains rows like `"cadaeic.space" -> "hh:cadaeic.space"`,
    // and inverting them yields a household key whose "login" is a house's name.
    // Measured against the refreshed registry: EIGHT handles — argos, arky,
    // errant, nfh, solin-sunraven, vertas-marginalia, yuanqu, zeno-at-the-seam —
    // would be written into the law store carrying a GitHub login they do not
    // have. A fabricated identity is worse than a missing one, and this store is
    // where the law's own reader goes looking.
    //
    // ONLY TWO KEY SHAPES CARRY A REAL LOGIN, and the file itself says which:
    //   `gh:<digits>`  a pin, so its binding came from tools/github-ids.json
    //   `login:<name>` binds its own name, which IS a login by construction —
    //                  and that case is already read straight off the key below,
    //                  so it does not need this map at all.
    // Every other shape (`hh:<house>`, `solo:<handle>`) is a sketchbook name.
    // Null, not a guess.
    const loginOfHousehold = githubLoginByHouseholdKey(logins);
    for (const handle of Object.keys(households).sort()) {
      const key = String(households[handle]);
      const login = loginOfHousehold.get(key) ?? null;
      push("roster", "WORLD/households.json", handle, { household: key, ...(login ? { login } : {}) });
      const ghId = /^gh:(\d+)$/.exec(key);
      identities.push({
        handle,
        household: key,
        human: null,                            // households.json states no human name
        gh_login: /^login:(.+)$/.exec(key)?.[1] ?? login,
        gh_id: ghId ? Number(ghId[1]) : null,
        since: null,                            // households.json states no join date
        status: "resident",                     // the file makes no meep/founder/retired distinction
        data: jsonSafe({ source: "WORLD/households.json", household_key: key }),
      });
    }
  }

  rows.sort((a, b) => (a.kind === b.kind ? (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
    : (a.kind < b.kind ? -1 : 1)));
  identities.sort((a, b) => (a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0));
  assertUniqueKeys(rows);
  return { rows, identities };
}

/**
 * `law_projection`'s primary key is (law_sha, kind, key), so two derived rows
 * sharing a key is a real fact about the law and must be REPORTED, not raised as
 * a constraint violation. Postgres would say
 * `duplicate key value violates unique constraint "law_projection_pkey"`, which
 * names neither the class nor the file; this names both, at derivation time,
 * before a connection is even opened. (This guard is the receipt of a live bug:
 * it is what the `[object Object]` grant collision looked like from the DB's
 * side, and the message it would have printed instead.)
 */
/**
 * A grant's key: the (class, action) pair — and the actor kind it is granted FOR
 * when that is not the resident. The arena's class mark (the 2026-08-29 dungeon
 * law) grants `strike`, `cast`, `guard` … to residents and AGAIN `for: human`;
 * two rows, one pair, and this pen refused world main on 2026-09-05 as "the law
 * states the same thing twice" — it did not; the key was too coarse. A resident
 * grant keeps the key it always had (`for:` absent means resident, the door's
 * own reading), so no projected row moves; a grant for another kind carries it.
 */
export function grantKey(cls, entry) {
  const base = `${cls}/${entry.action}`;
  const kind = entry.for == null ? "" : String(entry.for).trim();
  return kind && kind !== "resident" ? `${base}/for:${kind}` : base;
}

export function assertUniqueKeys(rows) {
  const seen = new Map();
  for (const r of rows) {
    const id = `${r.kind}/${r.key}`;
    const prior = seen.get(id);
    if (prior) {
      throw new Error(
        `the law derives two rows for ${id} — a projection key must be unique.\n` +
        `  first:  ${prior.path}\n  second: ${r.path}\n` +
        `Either the law states the same thing twice, or this pen's key for kind '${r.kind}' is too coarse.`);
    }
    seen.set(id, r);
  }
  return rows;
}

/** `git rev-parse HEAD` in the checkout — the ONLY git this pen runs, and it reads. */
export function headSha(repo) {
  return execFileSync("git", ["-C", resolve(repo), "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

/**
 * The `--sha` guard. The caller declares which sha it believes it handed us; a
 * checkout that says otherwise is refused rather than ingested under the wrong
 * stamp. Every row carries `law_sha`, and a window pins one — a projection
 * stamped with a sha it was not derived from would make the determinism bonus
 * (gold § 3: "every window's outcome is reproducible from (claims, law_sha)") a
 * lie that nothing downstream could detect.
 */
export function assertSha(repo, declared) {
  const head = headSha(repo);
  if (head !== declared) {
    throw new Error(
      `--sha ${declared} does not match ${resolve(repo)} HEAD ${head}. ` +
      `This pen never moves a checkout; put the checkout at the sha you mean, or pass the sha it is at.`);
  }
  return head;
}

// ── the write ────────────────────────────────────────────────────────────────

const CHUNK = 500;

/**
 * One transaction: clear this sha's rows, insert the derived set, replace
 * identities, move the head. Re-running the same sha is a no-op by construction
 * — that is what makes a webhook that fires twice harmless, and what lets the
 * red-proof restore itself by simply running again.
 */
export async function writeLaw(client, { lawSha, rows, identities, blessed = false }) {
  await client.query("BEGIN");
  try {
    await client.query("DELETE FROM law_projection WHERE law_sha = $1", [lawSha]);
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const values = [];
      const params = [];
      slice.forEach((r, n) => {
        const b = n * 4;
        values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${slice.length * 4 + 1})`);
        params.push(r.kind, r.path, r.key, JSON.stringify(r.data));
      });
      params.push(lawSha);
      await client.query(
        `INSERT INTO law_projection (kind, path, key, data, law_sha) VALUES ${values.join(", ")}`, params);
    }

    // ⚑ A BLESSED RUN STOPS HERE (POS-270, 2026-09-27). The office's class reads
    // ask law_projection at the NEWEST BLESSING — "the bless overrides the tick"
    // (Keemin, 2026-09-18, postmark#2934) — and main runs ahead of the tag between
    // a crossing and its blessing, so the blessed sha needs its own rows. Those
    // rows are the whole of a blessed run: `identities` is the CURRENT roster and
    // `projection_heads['world-law']` is the clearing's pin, and both belong to
    // the main run. A blessed run that moved either would hand the clearing an
    // older rulebook than the one it had.
    if (blessed) { await client.query("COMMIT"); return; }

    // identities carries NO law_sha (it is the CURRENT roster, not a per-sha
    // projection — see 001_tables.sql), and law_ingester is its only writer per
    // the registry, so replace-in-full is both correct and idempotent. Readers
    // see the old roster until this transaction commits.
    await client.query("DELETE FROM identities");
    for (let i = 0; i < identities.length; i += CHUNK) {
      const slice = identities.slice(i, i + CHUNK);
      const values = [];
      const params = [];
      slice.forEach((d, n) => {
        const b = n * 8;
        values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8})`);
        params.push(d.handle, d.household, d.human, d.gh_login, d.gh_id, d.since, d.status, JSON.stringify(d.data));
      });
      await client.query(
        `INSERT INTO identities (handle, household, human, gh_login, gh_id, since, status, data)
         VALUES ${values.join(", ")}`, params);
    }

    await client.query(
      `INSERT INTO projection_heads (repo, sha, ingested_at) VALUES ($1, $2, now())
       ON CONFLICT (repo) DO UPDATE SET sha = EXCLUDED.sha, ingested_at = EXCLUDED.ingested_at`,
      [LAW_REPO_KEY, lawSha]);

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }
}

export const censusOf = (rows) => {
  const c = {};
  for (const r of rows) c[r.kind] = (c[r.kind] ?? 0) + 1;
  return c;
};

// ── CLI ──────────────────────────────────────────────────────────────────────

const argOf = (name) => { const i = process.argv.indexOf(name); return i !== -1 ? process.argv[i + 1] : null; };
const flag = (name) => process.argv.includes(name);

async function main() {
  const lawRepo = argOf("--law-repo");
  const declared = argOf("--sha");
  if (!lawRepo || !declared) {
    console.error("usage: law-ingest.mjs --law-repo <checkout> --sha <law_sha> [--blessed] [--dry-run] [--json]");
    process.exit(2);
  }
  const lawSha = assertSha(lawRepo, declared);
  const { rows, identities } = await deriveLaw({ lawRepo });
  const census = censusOf(rows);
  const blessed = flag("--blessed");
  const summary = blessed
    ? { repo: LAW_REPO_KEY, law_sha: lawSha, blessed: true, rows: rows.length, census }
    : { repo: LAW_REPO_KEY, law_sha: lawSha, rows: rows.length, identities: identities.length, census };

  if (flag("--dry-run")) {
    console.log(flag("--json") ? JSON.stringify(summary, null, 2)
      : `dry-run · ${lawSha}\n  law_projection: ${rows.length} (${JSON.stringify(census)})\n  identities: ${identities.length}`);
    return;
  }

  const { default: pg } = await import("pg");
  const client = new pg.Client();               // PGHOST/PGDATABASE/PGUSER/PGPASSWORD
  await client.connect();
  try { await writeLaw(client, { lawSha, rows, identities, blessed }); }
  finally { await client.end(); }

  if (blessed) {
    console.log(flag("--json") ? JSON.stringify(summary, null, 2)
      : `ingested blessed law ${lawSha}\n  law_projection: ${rows.length} (${JSON.stringify(census)})\n  identities and projection_heads['${LAW_REPO_KEY}'] untouched (the main run's)`);
    return;
  }
  console.log(flag("--json") ? JSON.stringify(summary, null, 2)
    : `ingested law ${lawSha}\n  law_projection: ${rows.length} (${JSON.stringify(census)})\n  identities: ${identities.length}\n  projection_heads['${LAW_REPO_KEY}'] = ${lawSha}`);
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
  main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
}
