#!/usr/bin/env node
// seed-import.mjs — the genesis seed, frozen 1.0 settlement → World 2.0 tables.
//
// THE LAW THIS IMPLEMENTS (gold plan postmark-world-2.md § 4, phase 2), verbatim:
//
//   "Phase 2 — schema + seed (= Keemin's A): … seed from the most recent
//    settlement as if it were the only settlement — the frozen `sandbox/seed`
//    pair on the dev channel is exactly this, already built, affecting no users."
//
// "As if it were the only settlement" is the whole design of this file. The world
// at the frozen tag is a state, not a history: every mark standing in the register
// there is treated as having locked in ONE window — a genesis window that opened
// with the world and closed at the settlement commit. No prior windows are
// invented, no clearing is replayed, and nothing here decides anything. Replaying
// the real history is phase 5's job (the replay-parity gate), and it is a
// different tool with a different proof.
//
// ── THE STATELESS CONTRACT (gold § 2, the git-facing reuse line) ─────────────
//
//   "The two new sync jobs (law_ingester, snapshot_exporter) are built small and
//    STATELESS — GitHub-API commits or fresh shallow clone per run, discarded
//    after; NO long-lived clones on the box, which makes the month's entire
//    clone-pathology class (wedged rebases, ownership poisonings, stash/upstream
//    traps, ff-freezes) unrepresentable."
//
// The seed is not one of those two jobs — it runs once, not on a schedule — but it
// obeys the same contract, for the same reason and by the same means as its
// siblings (law-ingest.mjs, stamp-ingest.mjs): the CALLER supplies the checkout,
// already at the tag. This tool never creates, fetches, checks out, rebases or
// cleans one, and the only git it runs is `rev-parse`, to check the caller's
// `--tag`/`--sha` against the checkout's HEAD. A mismatch is REFUSED, never
// corrected — the genesis window pins `law_sha`, and a window pinned to a sha its
// rows were not derived from would make gold § 3's determinism property ("every
// window's outcome is reproducible from (claims, law_sha, town_sha)") a lie that
// nothing downstream could detect.
//
// ── REUSE, NOT RE-IMPLEMENTATION (gold § 2: "reuse the READERS") ─────────────
//
// The marks register is read by the world's OWN loader, imported live out of the
// checkout being seeded — the same `loadMarks`/`parseRecord` the fold, the lint,
// the hydrator and law-ingest.mjs all use, at the sha being seeded. In particular
// `loadMarks` is what applies the v3 frame (marks-fold.mjs § the frame), so every
// `at` this file sees is already in WORLD coordinates. No frontmatter parsing and
// no coordinate arithmetic is written here.
//
// ── THE PEN: THIS IS A MIGRATION, NOT A RUNTIME PATH ────────────────────────
//
// `claims`, `marks` and `windows` belong to `office_api` and `clearing_job`
// (001_tables.sql's registry rows). This tool holds NONE of those pens and does
// not pretend to: it connects as **world2_owner** and runs ONCE, before any pen
// has written anything. Seeding is DDL-adjacent — it is the schema's initial
// state, in the same class as the `registry` INSERT that ships inside
// 001_tables.sql — and it is not reachable from any request path. That is the
// justification for the owner connection, and it is the only one: nothing in the
// running town may ever call this file.
//
// ── USAGE ───────────────────────────────────────────────────────────────────
//
//   git clone --depth 1 --branch sandbox/seed \
//     https://github.com/keeminlee/postmark-world.git /tmp/frozen
//
//   PGHOST=localhost PGDATABASE=world2_dev PGUSER=world2_owner PGPASSWORD=… \
//     node world2/tools/seed-import.mjs \
//       --world-repo /tmp/frozen --tag sandbox/seed \
//       --town-sha 830a69963d8e4801ad4ed8bb80da38e79fd3fdbf \
//       --with-acts
//
//   --tag <ref> | --sha <sha>   what the caller believes the checkout is at (one required)
//   --town-sha <sha>            the town half of the certified pair, pinned on the window
//   --with-acts                 also translate STATE/log/*.jsonl into legacy `acts` rows
//   --upgrade                   the ONE sanctioned second run: fill the columns 004 added
//                               (data, parent) and insert the de-sited marks the pre-004
//                               schema had no row shape for. Additive; see `upgradeSeed`.
//   --strict                    exit 1 if anything the checkout holds is NOT CARRIED
//   --dry-run                   derive and print the census; open no connection
//   --verify                    re-derive and assert DB equality (exit 0 equal · 1 drift · 2 cannot run)
//   --can-fail-proof            mangle the seeded rows inside a ROLLED-BACK transaction and
//                               require --verify to go red — the receipt that verify can fail
//   --json                      machine-readable summary
//
// A checkout is a CHECKOUT, not a bare repo: this reads working-tree files.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

// ── the checkout's own reader, imported from the checkout ────────────────────
// Identical technique, and identical reasoning, to law-ingest.mjs: the code that
// parses sha X is the code that shipped at sha X. A copy would be a twin that
// drifts silently — the failure class gold § 3 rule 5 exists to forbid.
async function readersOf(worldRepo) {
  const toolUrl = (f) => pathToFileURL(join(resolve(worldRepo), "tools", f)).href;
  const mf = await import(toolUrl("marks-fold.mjs"));
  return { loadMarks: mf.loadMarks, fold: mf.fold };
}

/**
 * THE TWO DERIVED FIELDS, ASKED OF THE FOLD ITSELF (A/B findings AB-R.tier and
 * AB-R.household, 2026-08-28).
 *
 * `tier` and `declared_household` are not on a record. They are what the FOLD
 * says about a record after it has resolved the world, and marks-fold.mjs:1031
 * is where both are published:
 *
 *   `id: mk.id, kind: mk.kind, by: …, tier: markStanding(mk, byId), household: mk.household,`
 *   `declared_household: mk._cred, date: mk.date,`
 *
 * The first pass at the tier fix imported `markStanding` and called it on the raw
 * loader records. That was closer but still wrong, and the A/B probe kept six rows
 * red to say so. `markStanding` reads three fields the LOADER never writes and the
 * FOLD does, and the walk gives a different verdict without them:
 *
 *   `_cred`       the household grain — `households[handle] ?? solo:<handle>`.
 *                 Without it the walk compares HANDLES, so a mark standing on a
 *                 sibling handle's ground in the same household reads as a guest.
 *                 (rook-of-garrison/the-aerial-display-deck on sol-of-garrison's
 *                 parcel; rei/the-white-flower-at-wrights-door.)
 *   `_sovereign`  a sited mark standing wholly inside its own household's parcel.
 *                 The walk STOPS at sovereign ground; without the flag it walks
 *                 past the house it should have stopped at. (The three sable
 *                 marks; rei/the-garden-notebook-tin.)
 *   `_containedBy` the fold's containment answer, which the walk prefers over the
 *                 directory edge since the 2026-08-25 filing freeze.
 *
 * Measured on the frozen checkout: stamping `_containedBy` alone moves 0 of the 6;
 * `_cred` alone moves 2; the fold moves all 6, and reproduces `world-state.json`'s
 * `tier` and `declared_household` on 960 of 960 marks exactly. So the fold is
 * asked, rather than its preamble re-derived here — re-deriving it would be the
 * "second copy of this walk" mark-standing.mjs's own header forbids, one level up.
 *
 * THE FOLD IS AN ORACLE HERE, NOT THE RECORD SOURCE. `loadMarks` still supplies
 * the rows; this only answers two questions about them, keyed by id. And it folds
 * a CLONE, because `fold()` mutates the records it is handed (`_cred`,
 * `_sovereign`, `_containedBy` are stamped onto them in place) and `recordData`
 * copies every non-column key into `data` — folding the seed's own records would
 * silently plant the fold's scratch fields in 831 stored rows.
 *
 * A record the fold does not answer for STOPS the seed. A silent fallback to the
 * frontmatter is how this bug shipped the first time.
 *
 * EXPORTED because the two one-off dev repairs (repair-tier-2026-08-28.mjs,
 * repair-household-2026-08-28.mjs) true the ALREADY-seeded rows and must reach
 * the same verdict this does. A repair that derived its answer differently from
 * the seed would leave the database in a state no single run could reproduce.
 */
export function foldOracle({ repo, records, fold }) {
  const terrainPath = join(repo, "WORLD", "skeleton.json");
  const terrain = existsSync(terrainPath) ? JSON.parse(readFileSync(terrainPath, "utf8")) : null;
  const hhPath = join(repo, "WORLD", "households.json");
  const households = existsSync(hhPath) ? (JSON.parse(readFileSync(hhPath, "utf8")).households ?? null) : null;
  // Stakes are the ✦weight input and touch neither field this asks about; the
  // seed carries no stake ledger (it lives in the TOWN repo — marks-fold's own
  // `loadStakes` note), so the honest value is the empty one.
  const state = fold({ marks: structuredClone(records), terrain, stakes: [], households });
  const byId = new Map(state.marks.map((m) => [m.id, m]));
  return (rec) => {
    const m = byId.get(rec.id);
    if (!m) {
      throw new Error(
        `the fold returns no row for ${rec.id}, so its standing and household cannot be derived. ` +
        `Both fields are the fold's to answer (marks-fold.mjs § the published mark); seeding the ` +
        `record's own frontmatter instead is the A/B finding this seed was corrected for.`);
    }
    return { tier: m.tier, household: m.declared_household ?? null };
  };
}

/**
 * The oracle plus the records it was built from, for a checkout path — the whole
 * of what a repair pen needs, in one call, so no caller assembles the three
 * pieces slightly differently from the seed.
 */
export async function foldDerivedFor(worldRepo) {
  const repo = resolve(worldRepo);
  const { loadMarks, fold } = await readersOf(repo);
  const marksDir = join(repo, "WORLD", "marks");
  if (!existsSync(marksDir)) throw new Error(`no WORLD/marks under ${repo} — is this a world checkout?`);
  const records = loadMarks(marksDir);
  return { records, derive: foldOracle({ repo, records, fold }) };
}

// ── deterministic ids ────────────────────────────────────────────────────────
//
// `claims.id` defaults to `gen_random_uuid()` and `marks.id` is "= the locking
// claim's id" (001_tables.sql). For a seed, a RANDOM id would make two honest
// runs of the same frozen tag incomparable — the exact asymmetry law-ingest's
// `jsonSafe` note is about, one level up. So the seed derives each id from the
// thing it names: uuid v5 (RFC 4122 § 4.3, SHA-1) of the mark's slug under a
// fixed namespace. Same tag in, same ids out, on any machine, forever — which is
// what lets a snapshot diff and a replay-parity run compare row for row.
//
// The namespace is arbitrary but FROZEN: changing it renumbers the whole world.
const SEED_NAMESPACE = "5f9a1c07-3e64-4bd2-9c18-2a7be0d4f316";

export function uuid5(name, namespace = SEED_NAMESPACE) {
  const ns = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const h = createHash("sha1").update(ns).update(Buffer.from(name, "utf8")).digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50;          // version 5
  b[8] = (b[8] & 0x3f) | 0x80;          // RFC 4122 variant
  const hex = b.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ── geometry → the `bbox` column ─────────────────────────────────────────────
//
// A mark's rect is centred on `at` and sized by `extent` — the world's own
// definition (geometry.mjs `rect`, re-exported through marks-fold.mjs). The
// `bbox` column is a Postgres `box`, which is what the clearing's spatial query
// and the `parcels_do_not_overlap` exclusion constraint read.
//
// Postgres NORMALISES a box on input (it stores upper-right corner first), so the
// literal this builds and the literal a `SELECT` returns are not textually equal
// even when the box is. Everything downstream — the verify below included —
// therefore compares the four NUMBERS, never the two strings.
export function boxOf(at, extent) {
  const x1 = at.x - extent.w / 2, y1 = at.y - extent.h / 2;
  const x2 = at.x + extent.w / 2, y2 = at.y + extent.h / 2;
  return `((${x1},${y1}),(${x2},${y2}))`;
}

/**
 * A stable rendering of a jsonb value, for comparison only.
 *
 * `jsonb` STORES A VALUE, NOT A DOCUMENT: it sorts object keys on input (by key
 * length, then bytes), so `{"w":4,"h":6}` comes back as `{"h":6,"w":4}`. The
 * verifier's first run against the live dev DB reported all 409 marks as drift on
 * exactly that — every one a false alarm about a difference the database never had
 * a choice about, which is the same shape of bug as law-ingest.mjs's `jsonSafe`
 * note and the same reason it matters: a guard whose first real firing is a false
 * positive is a guard people turn off.
 *
 * The fix belongs HERE and not at the derivation, and the difference is worth
 * being precise about. `jsonSafe` fixed a deriver that was returning something the
 * database could not hold. This deriver is right — key order carries no meaning
 * and `geometry` round-trips perfectly — so what was wrong was the COMPARATOR,
 * asking about a serialisation when the question is about a value.
 */
export function canonicalJson(v) {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/** Parse either spelling of a box back to four numbers, for comparison. */
export function boxNumbers(text) {
  const n = String(text).match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)?.map(Number) ?? [];
  if (n.length !== 4) return null;
  return [Math.min(n[0], n[2]), Math.min(n[1], n[3]), Math.max(n[0], n[2]), Math.max(n[1], n[3])];
}

// ── what the 2.0 `marks` table holds, after 004 ──────────────────────────────
//
// The first cut of this seed could carry only 409 of the register's 960 records,
// and said so loudly: `geometry`/`bbox` were `NOT NULL`, so the 422 de-sited marks
// had no row shape, and 20 frontmatter fields on the marks that DID fit had no
// column. Migration `004_marks_data.sql` (Wright, 2026-08-28, ruling from those
// findings) closed both: `marks`/`claims` grew `data jsonb` and `parent uuid`,
// `geometry`/`bbox` became nullable, and the law moved into a CHECK —
//
//   CONSTRAINT sited_marks_have_a_where
//     CHECK (kind NOT IN ('sited','parcel') OR (geometry IS NOT NULL AND bbox IS NOT NULL))
//
// — "what stands IN the world has a where; what continues a parent does not".
//
// So the census below is no longer a list of losses. It is a list of what went to
// ANOTHER pen (class marks are law), plus the one edge the schema still cannot
// express (see `_parent_is_law`). `fields_with_no_column` should now be EMPTY on
// any checkout, and a test asserts exactly that — an empty census that could not
// have been empty before is the receipt that 004 did its job.
//
// The names below are the ones a COLUMN holds (under whatever name) or that are
// machine-dependent; everything else is the record's remainder and rides `data`.
const HELD_BY_A_COLUMN = new Set([
  "id", "slug", "kind", "by", "household", "body", "at", "extent",
  "points",                       // carried inside `geometry` — see the ring note below
  "parent",                       // carried as the `parent` uuid — see resolveParent below
  "_dir",                         // an absolute path on whichever machine parsed it
]);

// `data` is the record's OWN residue, not a second schema (004's words). It keeps
// the loader's bookkeeping — `_fileAt`, `_origin`, `_stray`, `_explicitParent`,
// `_parentMarkId` — for the same reason law-ingest's `recordData` does: those are
// the parser's output, and dropping them would be inventing a normal form no
// reader asked for. `_dir` alone is removed, because it is the one field that
// differs between two honest checkouts of the same sha.
const recordData = (rec) => {
  const out = {};
  for (const k of Object.keys(rec)) if (!HELD_BY_A_COLUMN.has(k)) out[k] = rec[k];
  return jsonSafe(out);
};

// THE STORAGE ROUND-TRIP, APPLIED AT DERIVATION — law-ingest.mjs's `jsonSafe`,
// for the same reason and against the same bug. `JSON.stringify` drops a key whose
// value is `undefined`, and a mark record has several (`_explicitParent` on any
// mark that authored no parent; both members of `_stray` on any mark carrying no
// legacy field). Without this the in-memory row would hold keys the stored row
// cannot, and `--verify` would report drift the database never had a choice about.
const jsonSafe = (v) => JSON.parse(JSON.stringify(v ?? null));

/**
 * Derive every seed row for one frozen checkout.
 *
 * PURE with respect to the checkout and the database: it reads files and returns
 * rows. Both the importer and the verifier call THIS — one derivation, so an
 * equality check can only ever be about the database, never about two readers
 * that fell out of step. (Same trade, and same stated caveat, as
 * falsifier-projection-equality.mjs: green means "the DB matches the repo", not
 * "the parse is right".)
 */
export async function deriveSeed({ worldRepo, lawSha, townSha = null, window: given = null }) {
  const repo = resolve(worldRepo);
  const { loadMarks, fold } = await readersOf(repo);

  const marksDir = join(repo, "WORLD", "marks");
  if (!existsSync(marksDir)) throw new Error(`no WORLD/marks under ${repo} — is this a world checkout?`);
  const records = loadMarks(marksDir);

  // THE HOUSEHOLD SPELLING (A/B finding AB-R.household, Wright's ruling
  // 2026-08-28): adopt 1.0's spelling, which is the fold's `declared_household`,
  // which is `households[handle] ?? solo:<handle>` (marks-fold.mjs § the
  // household grain). A roster owner keeps the household KEY (`gh:293432145`); a
  // non-roster owner is `solo:<handle>` and NEVER null.
  //
  // The earlier reading — NULL for a handle the roster does not name, on the
  // ground that inventing a key would be a fabrication — had the right instinct
  // and the wrong fact. `solo:<handle>` is not an invented key: it is the town's
  // own answer to "which household is this", written in the fold beside the
  // comment that explains it ("A handle in no declared household is its own
  // household — registry lag never blocks a new resident, it only leaves them
  // ungrouped until the town knows them"). NULL threw that answer away on 358 of
  // 831 marks and left `household` with three spellings across one column.
  //
  // So this no longer reads households.json directly. One question, one answerer.
  const oracle = foldOracle({ repo, records, fold });

  // `window`: a caller that wants the marks and not the seed's window hands one
  // in (snapshot-backfill.mjs: a settlement tag before STATE/log existed has no
  // town clock to read, and the snapshot never reads a window id).
  const window = given ?? genesisWindow({ repo, lawSha, townSha });
  const byId = new Map(records.map((r) => [r.id, r]));

  const claims = [];
  const marks = [];
  const notCarriedFields = {};
  const fieldsInData = {};
  const notPlaced = { law: [], parentIsLaw: [] };

  for (const rec of records.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    // A class mark is LAW, and law has a different pen. census.md decision 1
    // puts "class marks" under LAW (repo-first, ingested to `law_projection` by
    // `law_ingester`); a copy in `marks` would be the same row under two pens —
    // the two-pens disease this migration exists to end. So it is not seeded
    // here, and it is not "skipped" either: law-ingest.mjs is where it lands.
    if (rec.kind === "class") { notPlaced.law.push(rec.id); continue; }

    const id = uuid5(rec.id);
    const derived = oracle(rec);
    const household = derived.household;
    const placed = !!(rec.at && rec.extent);

    // `at` is already WORLD coordinates — `loadMarks` composed the v3 frame. The
    // file's own numbers stay behind in `_fileAt`, deliberately: a frame is a
    // property of the tree, and the tree does not come with us.
    //
    // A de-sited mark (predicated/naming) has neither, and after 004 that is a
    // representable row rather than an excluded one: NULL geometry and NULL bbox,
    // which `sited_marks_have_a_where` permits for exactly these kinds.
    let geometry = null, bbox = null;
    if (placed) {
      geometry = { at: { x: rec.at.x, y: rec.at.y }, extent: { w: rec.extent.w, h: rec.extent.h } };
      // A `points:` ring is part of the claim (marks-fold.mjs § placementParent,
      // the honesty gate): `marksContain` is coverage-honest when a ring is present
      // and bbox-analytic when it is not, so a ring dropped here would silently
      // widen twenty-one marks — the five inland waters among them — from their
      // real shape to their bounding box. It rides in `geometry`, which is jsonb
      // and can hold it; `bbox` stays the analytic rect either way, because that is
      // what the exclusion constraint and the spatial index read.
      if (Array.isArray(rec.points)) geometry.points = rec.points;
      bbox = boxOf(rec.at, rec.extent);
    }

    const { parent, parentIsLaw } = resolveParent(rec, byId);
    if (parentIsLaw) notPlaced.parentIsLaw.push({ id: rec.id, parent: parentIsLaw });

    const data = recordData(rec);
    // The DERIVED tier overrides the raw frontmatter (A/B finding AB-R.tier):
    // standing comes from the consent handshake, and the fold is what resolves
    // it — see `foldOracle` for why the fold and not `markStanding` alone.
    data.tier = derived.tier;
    // The one edge the schema cannot express, kept where it CAN be read. See
    // `resolveParent`: `parent` is a uuid into `marks`, and these parents are not
    // marks rows at all. The edge is preserved verbatim under its own key, counted
    // in the census, and listed in `windows.receipts` — a NULL that says why.
    if (parentIsLaw) data._parent_is_law = parentIsLaw;

    // The census of the remainder, and the census of what is genuinely LOST.
    // Before 004 these were the same list; they are not any more, and conflating
    // them would report `date` as a loss on every mark while `data.date` holds it.
    // A field is lost only if no column holds it AND it did not reach `data` —
    // which `recordData` makes impossible, so this stays empty unless the
    // remainder rule is edited. That is the point of still computing it.
    for (const k of Object.keys(rec)) {
      if (HELD_BY_A_COLUMN.has(k)) continue;
      // A key whose value is `undefined` is a key the record does not actually
      // state — `loadMarks` assigns `_explicitParent = rec.parent` on every mark,
      // so all 831 carry the NAME and only the ones that authored a parent carry a
      // VALUE. `jsonSafe` drops the rest, because jsonb cannot hold `undefined`.
      // Counting those as losses would report the storage round-trip as data loss,
      // which is law-ingest's 129-false-alarm bug wearing a census's clothes.
      if (rec[k] === undefined) continue;
      if (k in data) { fieldsInData[k] = (fieldsInData[k] ?? 0) + 1; continue; }
      notCarriedFields[k] = (notCarriedFields[k] ?? 0) + 1;
    }

    // One vocabulary across the two columns. `claims.class` is documented open
    // ("parcel | mark | stake | escrow | … (parity matrix finalizes)") and
    // `marks.kind` is read by the `parcels_do_not_overlap` constraint's
    // `WHERE (kind = 'parcel' …)`, so the 1.0 kind is carried through BOTH,
    // verbatim. The clearing job's future claim→mark mapping is then the
    // identity, and no translation table has to be kept in step with the law.
    claims.push({
      id, window_id: window.id, class: rec.kind, claimant: rec.by, household,
      submitted_at: window.opens_at, status: "locked", decided_at: window.cleared_at,
      body: rec.body ?? "", geometry, bbox, stake: 0, data, parent,
    });
    marks.push({
      id, slug: rec.id, kind: rec.kind, owner: rec.by, household,
      body: rec.body ?? "", geometry, bbox, status: "standing", locked_window: window.id,
      data, parent,
    });
  }

  const census = {
    records: records.length,
    marks: marks.length,
    claims: claims.length,
    by_kind: marks.reduce((a, m) => ({ ...a, [m.kind]: (a[m.kind] ?? 0) + 1 }), {}),
    placed: marks.filter((m) => m.geometry).length,
    de_sited: marks.filter((m) => !m.geometry).length,
    with_parent: marks.filter((m) => m.parent).length,
    not_carried: {
      class_marks_are_law: notPlaced.law.length,
      parent_is_law: notPlaced.parentIsLaw.length,
      // Empty on every checkout since 004. If this is ever non-empty again, a
      // field appeared that no column and no `data` holds — which cannot happen
      // while `data` is the remainder, so a non-empty census here means the
      // remainder rule was edited, not that the law grew a field.
      fields_with_no_column: notCarriedFields,
    },
    fields_in_data: fieldsInData,   // the remainder, carried — informational, not a loss
  };
  window.receipts = {
    note: "genesis seed",
    seeded_from: { world_sha: lawSha, town_sha: townSha, tool: "world2/tools/seed-import.mjs" },
    census,
    parent_is_law: notPlaced.parentIsLaw,
  };

  return { window, claims: orderByParent(claims), marks: orderByParent(marks), census, notPlaced, notCarriedFields, fieldsInData };
}

/**
 * A de-sited mark's `parent`, as a uuid into `marks`.
 *
 * 004: "a predicated/naming mark is its parent continued". That is the ONLY edge
 * this column carries. A sited or parcel mark gets NULL on purpose: its containment
 * is GEOMETRY, and since the filing freeze its directory is history, not a claim —
 * `WORLD/filing-freeze.json`: *"A mark's directory is its historical filing: it
 * carries no claim, and it never moves again."* Reading `_parentMarkId` into
 * `parent` for a placed mark would re-assert exactly the edge the freeze retired.
 *
 * A parent that does not resolve at all STOPS the seed. A predicated mark whose
 * parent is missing is not a mark with an unknown parent — it is a record the
 * register cannot explain, and seeding it with a silent NULL would put a broken
 * continuation into the world with nothing downstream able to notice.
 *
 * THE ONE CASE THE SCHEMA CANNOT EXPRESS, and it is real: 76 records — every one
 * `the-town`, `tier: constitution`, standing inside `the-town/the-keeping-works` —
 * are predicated on a CLASS mark (`the-town/exposure-engine` on `the-town/exposure`,
 * and so on: the law's own slot/engine records). Class marks are law and live in
 * `law_projection`, so their `marks.id` does not exist and the foreign key cannot
 * point at them. These return `parentIsLaw` — the parent's slug, preserved in
 * `data._parent_is_law`, counted in the census, listed in `windows.receipts`. The
 * column is NULL because the schema has no other answer; the edge is not lost, and
 * nothing about it is quiet.
 */
export function resolveParent(rec, byId) {
  if (rec.kind !== "predicated" && rec.kind !== "naming") return { parent: null, parentIsLaw: null };
  const named = rec.parent ?? rec._parentMarkId ?? null;
  if (named == null) {
    throw new Error(
      `${rec.id} is ${rec.kind} and names no parent — a ${rec.kind} mark IS its parent continued ` +
      `(004_marks_data.sql), so a parentless one is a record the register cannot explain. ` +
      `Seeding it with a NULL parent would put a broken continuation into the world.`);
  }
  const parent = byId.get(String(named));
  if (!parent) {
    throw new Error(
      `${rec.id} is predicated on '${named}', which is not in the marks register. ` +
      `The seed stops rather than dropping the edge.`);
  }
  if (parent.kind === "class") return { parent: null, parentIsLaw: parent.id };
  return { parent: uuid5(parent.id), parentIsLaw: null };
}

/**
 * `marks.parent` is a self-referencing foreign key and it is NOT deferrable, so a
 * child inserted before its parent is refused mid-transaction — and 90 of the
 * de-sited marks are nested under another de-sited mark, so slug order is not
 * enough. This puts parents before children and is otherwise stable (slug order
 * within a generation), which keeps two runs of the same tag byte-identical.
 *
 * A cycle cannot arise from a directory tree, but it is checked anyway: the
 * alternative to naming it here is a foreign-key error that names one row and not
 * the loop.
 */
export function orderByParent(rows) {
  const out = [];
  const emitted = new Set();
  let pending = rows.slice();
  while (pending.length) {
    const ready = pending.filter((r) => !r.parent || emitted.has(r.parent));
    if (!ready.length) {
      throw new Error(
        `the parent edges form a cycle among ${pending.length} record(s), e.g. ` +
        pending.slice(0, 3).map((r) => r.slug ?? r.id).join(", "));
    }
    for (const r of ready) { out.push(r); emitted.add(r.id); }
    const readySet = new Set(ready);
    pending = pending.filter((r) => !readySet.has(r));
  }
  return out;
}

/**
 * The genesis window, DISCOVERED from the checkout rather than declared.
 *
 * "The crossing NUMBER is the window id — the town's clock survives"
 * (001_tables.sql, on `windows`). At the frozen tag the town's clock reads
 * whatever the highest `STATE/log/<N>.jsonl` says, so that number is the id, its
 * `.meta.json` `covers_from` is when the window opened, and the settlement commit
 * the tag points at is when it closed. Nothing is invented: every field is a fact
 * the checkout already states.
 *
 * `status: 'closed'` because this window is over — it produced the register we
 * are seeding. Opening window N+1 is `clearing_job`'s act, not the seed's.
 */
export function genesisWindow({ repo, lawSha, townSha }) {
  const logDir = join(resolve(repo), "STATE", "log");
  if (!existsSync(logDir)) throw new Error(`no STATE/log under ${repo} — cannot read the town's clock`);
  const numbers = readdirSync(logDir)
    .map((f) => /^(\d+)\.jsonl$/.exec(f)?.[1]).filter(Boolean).map(Number)
    .sort((a, b) => a - b);
  if (!numbers.length) throw new Error(`STATE/log under ${repo} holds no <N>.jsonl — cannot read the town's clock`);
  const id = numbers[numbers.length - 1];

  const metaPath = join(logDir, `${id}.meta.json`);
  const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, "utf8")) : {};
  if (meta.crossing != null && Number(meta.crossing) !== id) {
    throw new Error(`STATE/log/${id}.meta.json says crossing ${meta.crossing} — the filename and the file disagree about the town's clock`);
  }
  const closedAt = commitDate(repo);
  return {
    id,
    opens_at: meta.covers_from ?? closedAt,
    closes_at: closedAt,
    status: "closed",
    law_sha: lawSha,
    town_sha: townSha,
    cleared_at: closedAt,
    receipts: null,                 // filled by deriveSeed, which knows the census
  };
}

// ── the legacy acts (`--with-acts`) ──────────────────────────────────────────
//
// 001_tables.sql on `acts`, verbatim:
//
//   "Its row grammar is the office JOURNAL's (dynamic-store.mjs `journal` table,
//    the 2026-08-23 witnessed-line ruling) — NOT the older STATE/log photograph
//    shape: position is an anchor and an offset ('a raw world x,y is a photograph
//    of a moving thing'). 1.0 sources at seed: the journal itself, plus
//    STATE/log/<N>.jsonl translated (legacy events ride with
//    action = 'legacy:<type>' and their original body in payload)."
//
// So the translation is deliberately SHALLOW, and the shallowness is the point:
//
//   at_anchor / at_dx / at_dy stay NULL. A legacy event carries a raw world x,y,
//   which is precisely the photograph the witnessed-line ruling refused. Writing
//   it into the anchor columns would forge a witnessed line nobody witnessed —
//   `{anchor: world, dx, dy}` reads as "we know what they stood relative to", and
//   we do not. The coordinates are not lost: they are in `payload`, where the
//   original event body rides whole.
//
//   class = 'legacy'. The journal's `class` is a live vocabulary (mark · frame ·
//   move · stance …, guarded by a denylist of the TOWN's classes, never an
//   allowlist — world-journal.mjs § THE TRIPWIRE). One word that is in neither
//   census keeps 2,400 imported rows from voting in a vocabulary they predate,
//   and `action` already carries the legacy type, so nothing is lost.
//
//   object stays NULL. An emission's `id` (`sound:1787…:actor`) is the emission's
//   own identity, not the thing acted upon; putting it in `object` would make
//   `acts_object_idx` answer a question nobody asked with rows that do not mean
//   what the column means.
const LEGACY_CLASS = "legacy";

/**
 * Every log file the town writes, and the crossing each one is filed under.
 *
 * WIDENED 2026-08-28 (the replay lane, from the settlement/S50 checkout). The
 * original shape here was `/^(\d+)\.jsonl$/`, which was complete for every
 * checkout the seed had ever been pointed at and is NOT complete for the town's
 * record generally: the 08-27 hand-drain (world commit 33332ec4, "the stranded
 * write-down") filed four windows under FRACTIONAL, `.journal`-suffixed names —
 *
 *   STATE/log/152.9084.journal.jsonl   STATE/log/153.journal.jsonl
 *
 * — and the integer-only pattern skips them silently. At `sandbox/seed` there
 * are none, so the seed's own behaviour is unchanged to the byte; between S49
 * and S50 there are seven acts inside them, and a replay that dropped seven acts
 * without saying so is the failure this file's own "a malformed line is REFUSED,
 * not skipped" note is against, one level up. A file the pattern does not match
 * is not refused — it is not seen at all, which is worse.
 *
 * The fractional name IS the crossing (the town's clock is fractional inside a
 * window — `acts.crossing` is `numeric` for exactly that reason), so the number
 * parsed out of the filename stays the fallback it always was.
 */
export const LOG_FILE = /^(\d+(?:\.\d+)?)(?:\.journal)?\.jsonl$/;

export function deriveActs({ worldRepo }) {
  const logDir = join(resolve(worldRepo), "STATE", "log");
  if (!existsSync(logDir)) throw new Error(`no STATE/log under ${worldRepo}`);
  const files = readdirSync(logDir)
    .map((f) => ({ f, n: Number(LOG_FILE.exec(f)?.[1]) }))
    .filter((x) => Number.isFinite(x.n)).sort((a, b) => a.n - b.n);

  const rows = [];
  const crossings = new Set();
  const byType = {};
  for (const { f, n } of files) {
    const text = readFileSync(join(logDir, f), "utf8");
    let lineNo = 0;
    for (const line of text.split(/\r?\n/)) {
      lineNo++;
      if (!line.trim()) continue;
      let e;
      // A malformed line is REFUSED, not skipped. A seed that quietly drops the
      // one line it could not read produces a world that is wrong by exactly the
      // amount nobody will ever look for.
      try { e = JSON.parse(line); }
      catch (err) { throw new Error(`STATE/log/${f}:${lineNo} is not JSON — ${err.message}`); }
      if (!e.at) throw new Error(`STATE/log/${f}:${lineNo} has no 'at' — an act without a time cannot be ordered`);
      if (!e.actor) throw new Error(`STATE/log/${f}:${lineNo} has no 'actor' — every act has a SUBJECT (world-journal.mjs)`);
      if (!e.type) throw new Error(`STATE/log/${f}:${lineNo} has no 'type' — nothing to name the action after`);

      // A departure states its own fractional crossing (the moment inside the
      // window); an emission or attachment states none, and falls back to the
      // window it was filed under, which is what the filename means.
      const crossing = e.payload?.crossing != null && Number.isFinite(Number(e.payload.crossing))
        ? Number(e.payload.crossing) : n;
      crossings.add(n);
      byType[e.type] = (byType[e.type] ?? 0) + 1;
      rows.push({
        at: e.at, crossing, actor: String(e.actor), action: `legacy:${e.type}`,
        object: null, at_anchor: null, at_dx: null, at_dy: null, witnesses: null,
        class: LEGACY_CLASS, payload: e, effect: null,
        household: null,          // STATE/log states none; see the README's note
        journal_seq: null,        // these rows never passed through the sqlite journal
      });
    }
  }
  rows.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return { rows, crossings: [...crossings].sort((a, b) => a - b), byType };
}

// ── git: the only two commands this pen runs, and both read ──────────────────

const git = (repo, ...args) => execFileSync("git", ["-C", resolve(repo), ...args], { encoding: "utf8" }).trim();

export const headSha = (repo) => git(repo, "rev-parse", "HEAD");
// Normalized through Date: git's %cI spells UTC as "Z" or "+00:00" depending on
// git version (2.46 vs 2.43 — the notary lane caught the box failing on exactly
// this). The seed pins the FORMAT, not the git version.
export const commitDate = (repo) => new Date(git(repo, "log", "-1", "--format=%cI")).toISOString();

/**
 * The `--tag`/`--sha` guard. The caller declares what it believes it handed us; a
 * checkout that says otherwise is refused rather than seeded under the wrong
 * stamp. A tag is resolved with `rev-parse <ref>^{commit}` so an ANNOTATED tag
 * (which `sandbox/seed` is — the pair's declaration lives in the tag message)
 * compares as its commit and not as its tag object.
 */
export function assertRef(repo, { tag, sha }) {
  const head = headSha(repo);
  if (sha && sha !== head) {
    throw new Error(
      `--sha ${sha} does not match ${resolve(repo)} HEAD ${head}. ` +
      `This pen never moves a checkout; put the checkout at the sha you mean, or pass the sha it is at.`);
  }
  if (tag) {
    let resolved;
    try { resolved = git(repo, "rev-parse", `${tag}^{commit}`); }
    catch { throw new Error(`--tag ${tag} does not exist in ${resolve(repo)} (a --depth 1 clone of a tag still carries that tag; a clone of a BRANCH does not carry it)`); }
    if (resolved !== head) {
      throw new Error(`--tag ${tag} is ${resolved} but ${resolve(repo)} HEAD is ${head}. Check the tag out, or seed the sha you are on.`);
    }
  }
  return head;
}

// ── the write ────────────────────────────────────────────────────────────────

const CHUNK = 500;

/**
 * THE SEED IS ONE TRANSACTION. Either the whole genesis state exists or none of
 * it does; a half-seeded world is the one outcome with no honest description.
 *
 * Idempotence is REFUSAL, not repair. Re-running is not a no-op the way the
 * projection pens' re-runs are, because these are `source` tables (registry, rule
 * 3): deleting a seeded mark to re-seed it would be `clearing_job`'s act
 * performed by the wrong pen, and `acts` carries an append-only trigger that
 * would refuse it anyway. So a second run stops and says how to actually start
 * over — rebuild the schema.
 */
export async function writeSeed(client, { window, claims, marks, acts }) {
  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO windows (id, opens_at, closes_at, status, law_sha, town_sha, cleared_at, receipts)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [window.id, window.opens_at, window.closes_at, window.status,
        window.law_sha, window.town_sha, window.cleared_at, JSON.stringify(window.receipts)]);

    // THE CANDLE IS NEVER LEFT UNLIT. The genesis window is CLOSED — it produced
    // the register being seeded — and 005_candle_tiling.sql says what a store with
    // no open window means, from the instance that taught it:
    //
    //   "window 150 closed 08-26 05:45Z, window 151 was hand-bootstrapped open at
    //    08-28 16:40Z — a 58.9-hour hole with no open candle. An act that fell into
    //    it reached `acts` with no claims row and NO REFUSAL … a hole neither
    //    accepts nor refuses."
    //
    // That hole was the SEED's, and it was repaired by hand rather than at its
    // source: seeding closed a window and opened nothing, so every seeded store
    // began life with no candle until somebody noticed. The successor now opens in
    // the same transaction, exactly where 005's trigger requires (at the
    // predecessor's close) and for the cadence census decision 3 rules (12 hours),
    // which is also what `clearing-job.mjs` does at every close after this one.
    // A hand-bootstrapped window is a state with no receipt; this one has the
    // seed's.
    await client.query(
      `INSERT INTO windows (id, opens_at, closes_at, status)
       VALUES ($1, $2, $2::timestamptz + interval '12 hours', 'open')`,
      [window.id + 1, window.closes_at]);

    await insertClaims(client, claims);
    await insertMarks(client, marks);

    for (let i = 0; acts && i < acts.length; i += CHUNK) {
      const slice = acts.slice(i, i + CHUNK);
      const values = []; const params = [];
      slice.forEach((a, n) => {
        const b = n * 13;
        values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11},$${b + 12},$${b + 13})`);
        params.push(a.at, a.crossing, a.actor, a.action, a.object, a.at_anchor, a.at_dx, a.at_dy,
          a.witnesses, a.class, JSON.stringify(a.payload), a.effect, a.household);
      });
      await client.query(
        `INSERT INTO acts (at, crossing, actor, action, object, at_anchor, at_dx, at_dy,
                           witnesses, class, payload, effect, household)
         VALUES ${values.join(", ")}`, params);
    }

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }
}

/**
 * `marks` rows in `orderByParent` order — parents before children, because
 * `marks.parent` is a non-deferrable self-FK.
 */
async function insertMarks(client, marks) {
  for (let i = 0; i < marks.length; i += CHUNK) {
    const slice = marks.slice(i, i + CHUNK);
    const values = []; const params = [];
    slice.forEach((m, n) => {
      const b = n * 12;
      values.push(`(${Array.from({ length: 12 }, (_, k) => `$${b + k + 1}`).join(",")})`);
      params.push(m.id, m.slug, m.kind, m.owner, m.household, m.body,
        m.geometry ? JSON.stringify(m.geometry) : null, m.bbox, m.status, m.locked_window,
        JSON.stringify(m.data), m.parent);
    });
    await client.query(
      `INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status,
                          locked_window, data, parent)
       VALUES ${values.join(", ")}`, params);
  }
}

async function insertClaims(client, claims) {
  for (let i = 0; i < claims.length; i += CHUNK) {
    const slice = claims.slice(i, i + CHUNK);
    const values = []; const params = [];
    slice.forEach((c, n) => {
      const b = n * 14;
      values.push(`(${Array.from({ length: 14 }, (_, k) => `$${b + k + 1}`).join(",")})`);
      params.push(c.id, c.window_id, c.class, c.claimant, c.household, c.submitted_at,
        c.status, c.decided_at, c.body, c.geometry ? JSON.stringify(c.geometry) : null,
        c.bbox, c.stake, JSON.stringify(c.data), c.parent);
    });
    await client.query(
      `INSERT INTO claims (id, window_id, class, claimant, household, submitted_at,
                           status, decided_at, body, geometry, bbox, stake, data, parent)
       VALUES ${values.join(", ")}`, params);
  }
}

/**
 * THE 004 UPGRADE — the one sanctioned second run, and the distinction that makes
 * it different from a reseed.
 *
 * A RESEED would replace rows the seed already wrote: it destroys state and the
 * pen that owns it is not this one, so it is refused, always, and there is no
 * `--force`. THIS is the opposite operation. It is `004_marks_data.sql` finished:
 * the migration added the columns, and the rows seeded before it carry NULL in
 * them. Nothing already written is overwritten with a different value — `data` and
 * `parent` go from NULL to the record they always described, and the 422 de-sited
 * marks that the pre-004 schema could not represent are inserted for the first
 * time. It is additive, it is derived from the same frozen tag, and running it
 * twice changes nothing the second time.
 *
 * The guard is what keeps that claim honest rather than merely stated:
 *
 *   1 · the genesis window must already exist, and its pins must match this
 *       checkout — an upgrade against a DIFFERENT tag is a reseed wearing a
 *       different word, and is refused;
 *   2 · every mark already present must agree with the checkout on every column
 *       the FIRST seed wrote. `verifySeed` is run over the intersection before a
 *       single row is touched, and a finding aborts. So the upgrade can only ever
 *       run on top of a seed that is still exactly what this tool wrote;
 *   3 · every row present must be missing `data` — one that already has it was
 *       written by a later hand, and the upgrade stops rather than talking over it.
 *
 * All of it, plus the inserts, in ONE transaction.
 */
export async function upgradeSeed(client, derived) {
  const { window, marks, claims } = derived;

  const w = await client.query("SELECT id, law_sha, town_sha FROM windows WHERE id = $1", [window.id]);
  if (!w.rowCount) {
    throw new Error(
      `--upgrade found no window ${window.id}: there is nothing seeded to upgrade. ` +
      `Run the seed without --upgrade.`);
  }
  if (w.rows[0].law_sha !== window.law_sha) {
    throw new Error(
      `--upgrade refused: window ${window.id} was seeded from law_sha ${w.rows[0].law_sha}, ` +
      `and this checkout is ${window.law_sha}. Upgrading across tags would rewrite the world ` +
      `under a different law — that is a reseed, and reseeding means rebuilding the schema.`);
  }

  const present = await client.query("SELECT slug, data IS NOT NULL AS has_data FROM marks");
  const presentSlugs = new Set(present.rows.map((r) => r.slug));
  const alreadyUpgraded = present.rows.filter((r) => r.has_data).map((r) => r.slug);
  if (alreadyUpgraded.length && alreadyUpgraded.length === present.rowCount && presentSlugs.size === marks.length) {
    return { already: true, updated: 0, inserted: 0 };
  }
  if (alreadyUpgraded.length) {
    throw new Error(
      `--upgrade refused: ${alreadyUpgraded.length} mark(s) already carry data, e.g. ${alreadyUpgraded[0]}. ` +
      `A partly-upgraded table was written by something other than this tool, and the upgrade will not ` +
      `talk over it. Rebuild the schema and seed once.`);
  }

  // Guard 2: the seed under us must still be exactly what this tool wrote. The
  // verifier is pointed at the INTERSECTION — the marks that were seedable before
  // 004, and their claims — because the de-sited ones are legitimately absent
  // until this run, and counting them as missing would refuse every real upgrade.
  const intersection = marks.filter((m) => presentSlugs.has(m.slug));
  const intersectionIds = new Set(intersection.map((m) => m.id));
  const seeded = {
    ...derived,
    marks: intersection,
    claims: claims.filter((c) => intersectionIds.has(c.id)),
  };
  const findings = await verifySeed(client, seeded, { columns: PRE_004_COLUMNS });
  if (findings.length) {
    throw new Error(
      `--upgrade refused: the seed already in the database does not match this checkout ` +
      `(${findings.length} finding(s)). The upgrade only ever runs on top of an intact seed.\n  ` +
      findings.slice(0, 3).join("\n  "));
  }

  // GUARD 4, and it is the one that decides the whole shape of this path.
  //
  // `002_grants.sql`'s `claims_update_guard` fires BEFORE UPDATE on every claim and
  // exempts exactly one role:
  //
  //   IF current_user = 'clearing_job' THEN RETURN NEW; END IF;
  //   IF OLD.status = 'pending' AND NEW.status = 'retracted' … THEN RETURN NEW;
  //   RAISE EXCEPTION 'claims: % may only retract a pending claim …'
  //
  // So a LOCKED claim's fields are immutable to every pen but the clearing job —
  // deliberately, because a locked claim is the record of what was submitted and
  // cleared. The seed connects as `world2_owner` (migration-class, § THE PEN), and
  // the owner is not exempt. That means `--upgrade` CANNOT complete for claims, and
  // the honest response is to say so before touching anything rather than to die
  // half-way, reach for `clearing_job`'s password, or disable a guard.
  //
  // On dev the answer is the one this tool already gives for a reseed: rebuild the
  // schema and seed once with 004 in place. Nothing is lost — every row is derived
  // from a frozen tag — and the primary path is the one that then gets exercised.
  const locked = await client.query(
    `SELECT count(*)::int c FROM claims WHERE window_id = $1 AND status = 'locked' AND data IS NULL`,
    [window.id]);
  const who = (await client.query("SELECT current_user AS u")).rows[0].u;
  if (locked.rows[0].c && who !== "clearing_job") {
    throw new Error(
      `--upgrade cannot finish: ${locked.rows[0].c} locked claim(s) need data, and 002_grants.sql's\n` +
      `claims_update_guard refuses an UPDATE on a locked claim from every role but clearing_job\n` +
      `(current_user is '${who}'). That guard is correct — a locked claim is the record of what was\n` +
      `submitted and cleared — so this pen will not work around it, borrow another pen's role, or\n` +
      `disable a trigger.\n\n` +
      `THE PATH IS THE REBUILD, and on dev it costs nothing: drop and re-apply\n` +
      `  world2/schema/001_tables.sql, 002_grants.sql, 003_falsifier_roles.sql, 004_marks_data.sql\n` +
      `then run the seed ONCE, without --upgrade. Every row is derived from the frozen tag, so a\n` +
      `rebuilt world is identical to an upgraded one — and the ids are deterministic, so it is\n` +
      `identical row for row.\n\n` +
      `(--upgrade remains the right path for marks alone, and for any future column 004-style\n` +
      ` migrations add to a table whose rows are still mutable by the pen that must fill them.)`);
  }

  await client.query("BEGIN");
  try {
    let updated = 0;
    for (const m of marks.filter((x) => presentSlugs.has(x.slug))) {
      const r = await client.query(
        "UPDATE marks SET data = $2, parent = $3 WHERE slug = $1", [m.slug, JSON.stringify(m.data), m.parent]);
      updated += r.rowCount;
      await client.query(
        "UPDATE claims SET data = $2, parent = $3 WHERE id = $1", [m.id, JSON.stringify(m.data), m.parent]);
    }
    // A claim and its mark share an id (001: `marks.id` = "the locking claim's
    // id"), so the ids of the marks being inserted for the first time are exactly
    // the claims that are missing too.
    const fresh = marks.filter((m) => !presentSlugs.has(m.slug));
    const freshIds = new Set(fresh.map((m) => m.id));
    await insertClaims(client, claims.filter((c) => freshIds.has(c.id)));
    await insertMarks(client, fresh);

    await client.query(
      "UPDATE windows SET receipts = $2 WHERE id = $1", [window.id, JSON.stringify(window.receipts)]);
    await client.query("COMMIT");
    return { already: false, updated, inserted: fresh.length };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }
}

/** The columns the pre-004 seed wrote — what an upgrade's precondition checks. */
const PRE_004_COLUMNS = ["id", "kind", "owner", "household", "body", "geometry", "bbox", "status", "locked_window"];
const ALL_COLUMNS = [...PRE_004_COLUMNS, "data", "parent"];

/**
 * Refuse a second seed, naming what is already there and what starting over
 * actually means. There is no `--force`: see `FORCE_RESEED_ANSWER`.
 */
export async function assertUnseeded(client, { window, acts }) {
  const w = await client.query("SELECT id, status FROM windows WHERE id = $1", [window.id]);
  if (w.rowCount) throw new Error(reseedRefusal(`windows already holds row ${window.id} (status ${w.rows[0].status})`));
  const m = await client.query("SELECT count(*)::int c FROM marks");
  if (m.rows[0].c) throw new Error(reseedRefusal(`marks already holds ${m.rows[0].c} row(s)`));
  const c = await client.query("SELECT count(*)::int c FROM claims");
  if (c.rows[0].c) throw new Error(reseedRefusal(`claims already holds ${c.rows[0].c} row(s)`));
  if (acts?.length) {
    const crossings = [...new Set(acts.map((a) => Math.floor(a.crossing)))];
    const a = await client.query(
      `SELECT floor(crossing)::int n, count(*)::int c FROM acts
        WHERE action LIKE 'legacy:%' AND floor(crossing)::int = ANY($1::int[])
        GROUP BY 1 ORDER BY 1`, [crossings]);
    if (a.rowCount) {
      throw new Error(reseedRefusal(
        `acts already holds legacy rows for crossing(s) ` +
        a.rows.map((r) => `${r.n} (${r.c})`).join(", ")));
    }
  }
}

const FORCE_RESEED_ANSWER =
  "There is no --force-reseed that deletes. `claims`, `marks` and `windows` are SOURCE tables owned by\n" +
  "office_api and clearing_job (001_tables.sql registry), and `acts` carries an append-only trigger:\n" +
  "a DELETE here would be one pen performing another's act, which is the disease this migration ends.\n" +
  "TO RESEED, REBUILD THE SCHEMA — drop and re-apply world2/schema/001_tables.sql, then run this again.\n" +
  "On dev that is cheap and it is the intended path; there is nothing in these tables a seed did not put there.\n" +
  "\n" +
  "IF YOU MEANT THE 004 UPGRADE, that is a different operation and it has its own flag: --upgrade.\n" +
  "A reseed REPLACES rows this pen already wrote. The upgrade only fills the columns 004 added (data,\n" +
  "parent — NULL until now) and inserts the de-sited marks the pre-004 schema had no row shape for.\n" +
  "It overwrites no value, it refuses unless the seed under it still matches this exact checkout, and\n" +
  "running it twice does nothing the second time.";

const reseedRefusal = (what) => `refusing to seed: ${what}.\n${FORCE_RESEED_ANSWER}`;

// ── verify ───────────────────────────────────────────────────────────────────

/**
 * Re-derive from the checkout and assert the database says the same thing.
 *
 * Exit codes mirror falsifier-projection-equality.mjs and for the same reason:
 * there is no code for "checked nothing and found nothing". A verifier that could
 * not compare must not report green, so an empty table or a missing window is a
 * FINDING, never a pass.
 *
 * Substance compared per slug: id · kind · owner · household · body · geometry ·
 * bbox · status · locked_window · data · parent — every column the seed writes.
 * `bbox` compares as four numbers because Postgres normalises the literal (see
 * `boxOf`); `geometry` and `data` compare canonically because jsonb sorts keys
 * (see `canonicalJson`).
 *
 * `columns` narrows the comparison, and it exists for exactly one caller: the 004
 * upgrade's precondition, which must ask "is the PRE-004 seed intact?" before it
 * fills columns that are legitimately NULL. Every other caller compares everything,
 * because a verifier that quietly skips a column is the thing this file is against.
 */
export async function verifySeed(client, { window, marks, claims }, { columns = ALL_COLUMNS } = {}) {
  const checks = new Set(columns);
  const findings = [];

  const w = await client.query("SELECT id, status, law_sha, town_sha FROM windows WHERE id = $1", [window.id]);
  if (!w.rowCount) findings.push(`windows has no row ${window.id} — nothing was seeded, or it was seeded under another id`);
  else {
    const r = w.rows[0];
    if (r.status !== window.status) findings.push(`windows ${window.id} status: repo says ${window.status}, DB says ${r.status}`);
    if (r.law_sha !== window.law_sha) findings.push(`windows ${window.id} law_sha: repo says ${window.law_sha}, DB says ${r.law_sha}`);
    if ((r.town_sha ?? null) !== (window.town_sha ?? null)) findings.push(`windows ${window.id} town_sha: repo says ${window.town_sha}, DB says ${r.town_sha}`);
  }

  // The successor the seed opens (see `writeSeed`). A verifier that does not check
  // what the seed wrote would let the 58.9-hour hole back in silently.
  const nx = await client.query(
    "SELECT id, opens_at, status FROM windows WHERE id = $1", [window.id + 1]);
  if (!nx.rowCount) findings.push(`windows has no row ${window.id + 1} — the seed closed the genesis window and opened no candle (005_candle_tiling: "a hole neither accepts nor refuses")`);
  else if (nx.rows[0].status !== "open") findings.push(`windows ${window.id + 1} is ${nx.rows[0].status}, not open — the successor the seed opens is the town's live candle`);
  else if (new Date(nx.rows[0].opens_at).toISOString() !== new Date(window.closes_at).toISOString())
    findings.push(`windows ${window.id + 1} opens at ${new Date(nx.rows[0].opens_at).toISOString()}, and ${window.id} closed at ${window.closes_at} — the candle must tile time`);

  const cq = await client.query("SELECT count(*)::int c FROM claims WHERE window_id = $1 AND status = 'locked'", [window.id]);
  if (cq.rows[0].c !== claims.length) findings.push(`claims locked in window ${window.id}: repo derives ${claims.length}, DB holds ${cq.rows[0].c}`);

  const mq = await client.query(
    `SELECT id::text, slug, kind, owner, household, body, geometry, bbox::text, status,
            locked_window, data, parent::text
       FROM marks ORDER BY slug`);
  if (mq.rowCount !== marks.length) findings.push(`marks: repo derives ${marks.length}, DB holds ${mq.rowCount}`);

  findings.push(...compareMarks(mq.rows, marks, { columns }));

  // `data` and `parent` ride the claim through the candle too (004), so a backfill
  // that filled `marks` and forgot `claims` must not read as green.
  if (checks.has("data") || checks.has("parent")) {
    const cd = await client.query(
      `SELECT count(*)::int c FROM claims WHERE window_id = $1 AND data IS NULL`, [window.id]);
    if (cd.rows[0].c) findings.push(`claims in window ${window.id}: ${cd.rows[0].c} row(s) carry no data — marks were upgraded and claims were not`);
    const cp = await client.query(
      `SELECT count(*)::int c FROM claims c JOIN marks m ON m.id = c.id
        WHERE c.parent IS DISTINCT FROM m.parent`);
    if (cp.rows[0].c) findings.push(`claims: ${cp.rows[0].c} row(s) disagree with their mark about parent`);
  }

  return findings;
}

/**
 * The per-slug comparator, over a `marks` SELECT and the rows a checkout derives.
 *
 * EXTRACTED from `verifySeed` 2026-08-28 for the replay-parity gate
 * (`replay-ingest.mjs`), which asks the same question of a differently-shaped
 * world: after a settlement era is replayed, does 2.0's standing register say
 * what 1.0's says at that settlement's tag? Everything about "does the DB agree
 * with the checkout, slug by slug" is the same question and must be answered by
 * the same code — a second copy of this loop is the twin that drifts silently,
 * which is what `foldOracle` and `readersOf` both exist to avoid one level up.
 *
 * What differs between the two callers is only the SCOPE, and it is passed in:
 * the seed compares every column it wrote, and the replay cannot compare
 * `locked_window` (a replayed mark locks in the window that actually cleared it,
 * which is the whole point) and reports the columns 2.0's write path leaves NULL
 * as their own named findings rather than as per-slug drift.
 *
 * `dbRows` are `marks` rows with `bbox::text` and `parent::text` — see the query
 * in `verifySeed`, which is the shape both callers select.
 */
export function compareMarks(dbRows, marks, { columns = ALL_COLUMNS, label = "marks" } = {}) {
  const checks = new Set(columns);
  const findings = [];
  const dbBySlug = new Map(dbRows.map((r) => [r.slug, r]));
  for (const m of marks) {
    const r = dbBySlug.get(m.slug);
    if (!r) { findings.push(`${label} MISSING in DB: ${m.slug}`); continue; }
    dbBySlug.delete(m.slug);
    const say = (field, repoV, dbV) => findings.push(`${label} DIFFERS at ${m.slug} · field ${field}\n    repo says: ${repoV}\n    DB says:   ${dbV}`);
    const plain = (field, repoV, dbV) => { if ((repoV ?? null) !== (dbV ?? null)) say(field, repoV, dbV); };
    if (checks.has("id")) plain("id", m.id, r.id);
    if (checks.has("kind")) plain("kind", m.kind, r.kind);
    if (checks.has("owner")) plain("owner", m.owner, r.owner);
    if (checks.has("household")) plain("household", m.household, r.household);
    if (checks.has("body") && r.body !== m.body) say("body", firstDivergence(m.body, r.body), firstDivergence(r.body, m.body));
    if (checks.has("geometry")) {
      const repoGeo = canonicalJson(m.geometry), dbGeo = canonicalJson(r.geometry);
      if (repoGeo !== dbGeo) say("geometry", firstDivergence(repoGeo, dbGeo), firstDivergence(dbGeo, repoGeo));
    }
    if (checks.has("bbox")) {
      // Both NULL is the de-sited case and agrees; one NULL is drift.
      if (m.bbox == null || r.bbox == null) plain("bbox", m.bbox, r.bbox);
      else {
        const a = boxNumbers(m.bbox), b = boxNumbers(r.bbox);
        if (!a || !b || a.some((v, i) => v !== b[i])) say("bbox", m.bbox, r.bbox);
      }
    }
    if (checks.has("status")) plain("status", m.status, r.status);
    if (checks.has("locked_window")) plain("locked_window", m.locked_window, r.locked_window);
    if (checks.has("data")) {
      const repoData = canonicalJson(m.data), dbData = canonicalJson(r.data);
      if (repoData !== dbData) say("data", firstDivergence(repoData, dbData), firstDivergence(dbData, repoData));
    }
    if (checks.has("parent")) plain("parent", m.parent, r.parent);
  }
  for (const slug of dbBySlug.keys()) findings.push(`${label} EXTRA in DB (the checkout derives no such mark): ${slug}`);
  return findings;
}

/** A long body's whole text is noise in a diff; show where it first parts company. */
function firstDivergence(a, b, span = 60) {
  const s = String(a ?? ""), t = String(b ?? "");
  let i = 0; while (i < s.length && i < t.length && s[i] === t[i]) i++;
  const from = Math.max(0, i - span / 2);
  return `${from ? "…" : ""}${s.slice(from, from + span)}${from + span < s.length ? "…" : ""} (first divergence at char ${i})`;
}

// ── the can-fail proof ───────────────────────────────────────────────────────
//
// "A falsifier nobody has watched fail is not a falsifier" (world2/tools/README).
// The projection guard's red-proof is a hand recipe because its mangles have to
// COMMIT — the ingester role holds no UPDATE, so only the owner can drift a row,
// and the repair is another run of the pen. This one is different: the seed runs
// as the owner already, and re-seeding is deliberately impossible, so a committed
// mangle would leave the world wrong with no pen able to fix it. The proof is
// therefore run INSIDE A TRANSACTION AND ROLLED BACK — same connection, so the
// verifier sees the uncommitted mangle; no trace afterwards.
//
// The mangles are the shapes of drift a seed can suffer: a value changed, a row
// gone, a row that should not exist — and since 004, the two columns the upgrade
// fills, because a backfill nobody can watch fail is not a backfill. If any mangle
// fails to turn the verifier red, the verifier is not checking what it claims to.
export async function canFailProof(client, derived) {
  const clean = await verifySeed(client, derived);
  if (clean.length) throw new Error(`cannot prove can-fail: verify is ALREADY red (${clean.length} finding(s))\n  ${clean[0]}`);
  const victim = derived.marks[0];
  if (!victim) throw new Error("cannot prove can-fail: the checkout derives no marks");
  // The de-sited marks are the ones the upgrade INSERTED and the only ones with a
  // parent to drift, so the parent mangle has to aim at one of them or it proves
  // nothing about the half of the register this extension added.
  const continued = derived.marks.find((m) => m.parent);
  const desited = derived.marks.find((m) => !m.geometry);

  const results = [];
  const mangle = async (label, sql, params = []) => {
    await client.query("BEGIN");
    try {
      await client.query(sql, params);
      results.push({ mangle: label, findings: await verifySeed(client, derived) });
    } finally {
      await client.query("ROLLBACK");
    }
  };

  try {
    await mangle(`body of ${victim.slug}`,
      "UPDATE marks SET body = body || ' — MANGLED' WHERE slug = $1", [victim.slug]);

    const gone = derived.marks[1]?.slug ?? victim.slug;
    await mangle(`DELETE ${gone}`, "DELETE FROM marks WHERE slug = $1", [gone]);

    await mangle("INSERT forged/not-a-real-mark",
      `INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, data)
       VALUES (gen_random_uuid(), 'forged/not-a-real-mark', 'sited', 'nobody', NULL, '',
               '{"at":{"x":0,"y":0},"extent":{"w":1,"h":1}}'::jsonb, '((-0.5,-0.5),(0.5,0.5))'::box,
               'standing', $1, '{}'::jsonb)`, [derived.window.id]);

    // 004's two columns. A NULLed `data` is exactly what the pre-upgrade world
    // looked like, so this mangle asks the verifier the backfill's own question.
    await mangle(`data of ${victim.slug} set to NULL (the pre-upgrade shape)`,
      "UPDATE marks SET data = NULL WHERE slug = $1", [victim.slug]);
    await mangle(`data of ${victim.slug} given a forged key`,
      `UPDATE marks SET data = data || '{"forged":true}'::jsonb WHERE slug = $1`, [victim.slug]);

    if (continued) {
      await mangle(`parent of ${continued.slug} set to NULL (the continuation edge cut)`,
        "UPDATE marks SET parent = NULL WHERE slug = $1", [continued.slug]);
    }
    // The two claims-side findings, mangled the only way the owner CAN mangle a
    // claim. `claims_update_guard` refuses an owner UPDATE on a locked claim — the
    // same guard that decided `--upgrade`'s shape — so neither of these is an
    // `UPDATE claims`. INSERT is not guarded (the trigger is BEFORE UPDATE only),
    // and `marks` is freely mutable by its owner, so each finding is provoked from
    // the side that is reachable. A check that cannot be made to fire is a check
    // nobody should trust, and working around the guard to fire it would be worse
    // than not proving it.
    await mangle("a claim in the genesis window carrying no data (the un-upgraded shape)",
      `INSERT INTO claims (id, window_id, class, claimant, status, body, data)
       VALUES (gen_random_uuid(), $1, 'sited', 'nobody', 'locked', '', NULL)`, [derived.window.id]);
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* already rolled back */ }
    throw e;
  }

  const after = await verifySeed(client, derived);
  const silent = results.filter((r) => !r.findings.length);
  return { results, restored: after.length === 0, silent };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const argOf = (name) => { const i = process.argv.indexOf(name); return i !== -1 ? process.argv[i + 1] : null; };
const flag = (name) => process.argv.includes(name);

function printNotCarried(census) {
  const nc = census.not_carried;
  const fields = Object.entries(nc.fields_with_no_column).sort((a, b) => b[1] - a[1]);
  console.log("\nNOT CARRIED — what this pen does not put in `marks`, and why:");
  if (nc.class_marks_are_law)
    console.log(`  ${nc.class_marks_are_law} class mark(s) — LAW, and law_ingester's pen, not this one (census.md decision 1). Not a loss.`);
  if (nc.parent_is_law)
    console.log(`  ${nc.parent_is_law} mark(s) are predicated on a CLASS mark, whose row lives in law_projection, so\n` +
                `      marks.parent (a uuid into marks) cannot point at it. parent is NULL and the edge is kept\n` +
                `      verbatim in data._parent_is_law. Listed in windows.receipts. NEEDS A RULING.`);
  if (fields.length) {
    console.log(`  ${fields.length} frontmatter field(s) have no column AND no place in data — this should be`);
    console.log("      impossible since 004, so it means the remainder rule was edited:");
    for (const [k, n] of fields) console.log(`      ${k.padEnd(16)} on ${n} mark(s)`);
  } else {
    const carried = Object.entries(census.fields_in_data ?? {}).sort((a, b) => b[1] - a[1]);
    console.log(`  0 frontmatter fields dropped — the ${carried.length} the columns do not hold ride \`data\` (004):`);
    console.log(`      ${carried.slice(0, 8).map(([k, n]) => `${k} ${n}`).join(" · ")}` +
      (carried.length > 8 ? ` · +${carried.length - 8} more` : ""));
  }
}

async function main() {
  const worldRepo = argOf("--world-repo");
  const tag = argOf("--tag");
  const sha = argOf("--sha");
  if (!worldRepo || (!tag && !sha)) {
    console.error("usage: seed-import.mjs --world-repo <checkout> (--tag <ref> | --sha <sha>) [--town-sha <sha>]\n" +
      "                      [--with-acts] [--upgrade] [--strict] [--dry-run] [--verify]\n" +
      "                      [--can-fail-proof] [--json]");
    process.exit(2);
  }
  if (flag("--force-reseed")) { console.error(FORCE_RESEED_ANSWER); process.exit(2); }

  const lawSha = assertRef(worldRepo, { tag, sha });
  const townSha = argOf("--town-sha");
  const derived = await deriveSeed({ worldRepo, lawSha, townSha });
  const acts = flag("--with-acts") ? deriveActs({ worldRepo }) : null;
  const summary = {
    world_sha: lawSha, town_sha: townSha, window: derived.window.id,
    rows: { windows: 1, claims: derived.claims.length, marks: derived.marks.length, acts: acts?.rows.length ?? 0 },
    census: derived.census,
    ...(acts ? { acts_by_type: acts.byType, acts_crossings: `${acts.crossings[0]}–${acts.crossings[acts.crossings.length - 1]}` } : {}),
  };

  const lossy = derived.notPlaced.parentIsLaw.length || Object.keys(derived.notCarriedFields).length;

  if (flag("--dry-run")) {
    if (flag("--json")) console.log(JSON.stringify(summary, null, 2));
    else {
      console.log(`dry-run · world ${lawSha}${townSha ? ` · town ${townSha}` : ""}`);
      console.log(`  windows: 1 (id ${derived.window.id}, ${derived.window.opens_at} → ${derived.window.closes_at}, closed)`);
      console.log(`  claims:  ${derived.claims.length} (all locked)`);
      console.log(`  marks:   ${derived.marks.length} ${JSON.stringify(derived.census.by_kind)}`);
      console.log(`           ${derived.census.placed} placed · ${derived.census.de_sited} de-sited (NULL geometry) · ${derived.census.with_parent} carry a parent edge`);
      if (acts) console.log(`  acts:    ${acts.rows.length} legacy ${JSON.stringify(acts.byType)} · crossings ${acts.crossings[0]}–${acts.crossings[acts.crossings.length - 1]}`);
      printNotCarried(derived.census);
    }
    process.exit(flag("--strict") && lossy ? 1 : 0);
  }

  const { default: pg } = await import("pg");
  const client = new pg.Client();               // PGHOST/PGDATABASE/PGUSER/PGPASSWORD
  await client.connect();
  try {
    if (flag("--verify") || flag("--can-fail-proof")) {
      if (flag("--can-fail-proof")) {
        const proof = await canFailProof(client, derived);
        for (const r of proof.results) {
          console.log(`${r.findings.length ? "RED  " : "GREEN"} after mangle: ${r.mangle} — ${r.findings.length} finding(s)`);
          // Up to three, not one: a single mangle can trip checks on both sides
          // (cutting a mark's parent also makes its claim disagree), and showing
          // only the first would hide that the claims-side check fired at all.
          for (const f of r.findings.slice(0, 3)) console.log(`  ${f.split("\n").join("\n  ")}`);
        }
        console.log(proof.restored ? "GREEN after rollback — the mangles left no trace" : "RED after rollback — THE PROOF DID NOT CLEAN UP");
        const ok = proof.silent.length === 0 && proof.restored;
        console.log(ok ? "\ncan-fail PROVEN: every mangle turned the verifier red, and rollback restored green."
          : `\ncan-fail NOT PROVEN: ${proof.silent.length} mangle(s) the verifier did not notice.`);
        process.exit(ok ? 0 : 1);
      }
      const findings = await verifySeed(client, derived);
      if (flag("--json")) console.log(JSON.stringify({ ...summary, findings }, null, 2));
      else if (findings.length) {
        console.log(`RED · seed @ ${lawSha} — ${findings.length} finding(s)`);
        for (const f of findings.slice(0, 40)) console.log(`  - ${f}`);
        if (findings.length > 40) console.log(`  … and ${findings.length - 40} more`);
      } else {
        console.log(`GREEN · seed @ ${lawSha} — window ${derived.window.id}, ${derived.marks.length} marks, ${derived.claims.length} locked claims agree with the checkout`);
      }
      process.exit(findings.length ? 1 : 0);
    }

    if (flag("--upgrade")) {
      const r = await upgradeSeed(client, derived);
      if (flag("--json")) console.log(JSON.stringify({ ...summary, upgrade: r }, null, 2));
      else if (r.already) {
        console.log(`already upgraded · world ${lawSha} — every mark carries data; nothing to do.`);
      } else {
        console.log(`upgraded (004) · world ${lawSha}${townSha ? ` · town ${townSha}` : ""}`);
        console.log(`  marks  backfilled ${String(r.updated).padStart(5)}   data + parent filled on rows the pre-004 seed wrote`);
        console.log(`  marks  inserted   ${String(r.inserted).padStart(5)}   de-sited marks the pre-004 schema had no row shape for`);
        console.log(`  claims            ${String(r.updated + r.inserted).padStart(5)}   the same remainder rides the claim (004)`);
        console.log(`  windows receipts rewritten with the new census`);
        printNotCarried(derived.census);
      }
      process.exit(flag("--strict") && lossy ? 1 : 0);
    }

    await assertUnseeded(client, { window: derived.window, acts: acts?.rows });
    await writeSeed(client, { ...derived, acts: acts?.rows });
    if (flag("--json")) console.log(JSON.stringify(summary, null, 2));
    else {
      console.log(`seeded · world ${lawSha}${townSha ? ` · town ${townSha}` : ""}`);
      console.log(`  windows ${String(1).padStart(5)}   (id ${derived.window.id}, closed ${derived.window.closes_at})`);
      console.log(`  claims  ${String(derived.claims.length).padStart(5)}   (all locked)`);
      console.log(`  marks   ${String(derived.marks.length).padStart(5)}   ${JSON.stringify(derived.census.by_kind)}`);
      console.log(`          ${String(derived.census.placed).padStart(5)}   placed · ${derived.census.de_sited} de-sited · ${derived.census.with_parent} carry a parent edge`);
      console.log(`  acts    ${String(acts?.rows.length ?? 0).padStart(5)}   ${acts ? `legacy ${JSON.stringify(acts.byType)}` : "(--with-acts not given)"}`);
      printNotCarried(derived.census);
    }
    process.exit(flag("--strict") && lossy ? 1 : 0);
  } finally {
    await client.end();
  }
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
  main().catch((e) => { console.error(e.message); process.exit(2); });
}
