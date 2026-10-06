// falsifier-standing-equality.mjs — the guard on the port.
//
// `standing.mjs` is a PORT of 1.0's standing walk (mark-standing.mjs, plus the
// three fold-derived fields it reads), and mark-standing.mjs's own header says
// what a port costs: "One definition, five consumers … a second copy of this
// walk is a future drift; import it." The clearing job cannot import it — it
// holds no world checkout, and the stateless contract belongs to the ingesters —
// so what stands in for the import is this: run BOTH, over the same state, and
// name every slug they disagree about.
//
// THE ORACLE IS THE FOLD, not `markStanding` alone. That distinction cost the
// seed lane six rows and is written in seed-import.mjs § foldOracle:
//
//   "The first pass at the tier fix imported `markStanding` and called it on the
//    raw loader records. That was closer but still wrong, and the A/B probe kept
//    six rows red to say so. `markStanding` reads three fields the LOADER never
//    writes and the FOLD does … the fold moves all 6, and reproduces
//    `world-state.json`'s `tier` and `declared_household` on 960 of 960 marks
//    exactly."
//
// So the comparison is: the port over `marks` rows, against `foldDerivedFor`'s
// answer over a checkout — the same oracle the seed and the replay gate use.
// This is DELIBERATELY the opposite of the projection falsifier's
// shared-derivation design: there, "two derivations would make a green mean only
// 'both parsers agree'". Here two derivations are the whole point, because what
// is under test IS the second derivation.
//
// ── EXIT CODES ───────────────────────────────────────────────────────────────
//
//   0  the port and the fold agree on every slug, and the store carries it
//   1  RED — a divergence, named per slug with both values
//   2  CANNOT RUN
//
// There is no code for "checked nothing and found nothing" (the siblings' rule):
// an empty `marks`, a checkout with no register, a checkout at a state the store
// is not at, or a comparison that ended up with zero slugs in common all exit 2,
// loudly.
//
// ── TWO QUESTIONS, AND THEY ARE NOT THE SAME QUESTION ────────────────────────
//
//   THE WALK      does `computeStanding` over the store's rows say what the fold
//                 says over the checkout? This is the port's correctness, and it
//                 is checkable whether or not the store has been recomputed.
//   THE STORE     does the `data.tier` actually stored equal what the walk says?
//                 This is finding 4 itself — a stale value in a source column —
//                 and it is what the recompute-at-close is supposed to make
//                 permanently true.
//
// Both are reported and both are RED, because a port that is right about a store
// nobody wrote it into is not the thing that was built.
//
// ── CORRECTED 2026-08-29 · THE SAME STATE, WHICH THIS WAS NOT ASKING ─────────
//
// This falsifier ran RED live on berthillon/le-petit-berthillon — "fold says:
// market · port says: home" — and the finding was carried upward as evidence
// that the clearing job's recompute re-introduces the repaired tier defect.
// It does not. The port was right and the oracle was old.
//
// `berthillon/chez-antoine` is a 25x25 PARCEL held by solo:berthillon standing
// exactly under the shop. So the shop is `_sovereign`, the walk stops there,
// holder === house, and the verdict is `home` — the sovereignty law working.
// chez-antoine is 2.0-born: it is in the store and in NEITHER the frozen tag nor
// world main, because a mark born in 2.0 has no file for a checkout to hold. The
// fold says `market` only because it is answering about a world that predates a
// parcel a resident really holds.
//
// The rule that failed is this module's own, quoted from the top of this file:
//
//   "what stands in for the import is this: run BOTH, OVER THE SAME STATE, and
//    name every slug they disagree about"
//
// It was not running them over the same state. The store holds marks the
// checkout does not, and this file already knew that — it reports them, one per
// slug, as "store carries X, which the checkout's register does not". But it
// excused them BY MEMBERSHIP, and standing is RELATIONAL: sovereignty and
// containment are answers about the ground a mark stands on, so one store-only
// parcel re-answers every mark inside it. A slug present in BOTH sets can have
// its verdict changed by a mark present in only one. That is the case that
// slipped through, and on the live store it was 2 of 19 findings with 1 cause.
//
// THE ATTRIBUTION RULE, which is the membership exclusion made relational: a
// WALK divergence is attributable to state the oracle cannot see IF re-walking
// WITHOUT the store-only marks makes the port agree with the fold. Attributed
// divergences are reported with their cause named — never silently dropped —
// and do not turn this red. Anything that survives the removal is a real port
// defect and stays RED. It cannot launder one: the removal only takes away rows
// the checkout provably does not have, so a defect in the walk itself, or a
// mangled shared row, is untouched by it and still diverges.
//
// ── EXTENDED 2026-09-02 · THE OTHER DIRECTION, WHICH THE PARKED INGEST OPENED ─
//
// The 08-29 correction attributed divergences to STORE-only ground. The shadow
// era then created the mirror case at scale: the git ingest is PARKED by ruling
// (2026-08-31 — "the shadow writer is the store's sole pen; the v1-vs-v2 store
// diff IS the writer comparison"), so ground that enters the world by the GIT
// pen (a founder-seated parcel, a settlement-published draft) reaches the
// CHECKOUT and never the store. Standing is relational in this direction too:
// a parcel the store cannot see re-answers every mark standing on it (the
// 09-02 live case: the parcel drain's 17 seats moved seven shared slugs).
//
// So attribution is now symmetric. A WALK divergence not excused by removing
// the store-only ground is re-tried by ADDING the checkout-only ground (the
// oracle's world, expressed in rows): if the port then agrees with the fold,
// the two were answering about different worlds and the port is not what is
// wrong. Same discipline as before — attributed rows are REPORTED with their
// cause named, never dropped, and never red; anything surviving BOTH re-walks
// is a real defect of the walk and stays RED. It cannot launder one: the
// addition only supplies rows the checkout provably holds, so a mangled shared
// row or a broken walk still diverges with them present.
//
// AND THE STORE IS ASKED AGAINST THE WALK, which is what the paragraph above
// says it was always for ("does the `data.tier` actually stored equal what the
// walk says?") and not what the code did — it compared the stored value to the
// FOLD, so every attributable walk divergence was double-reported as a second,
// independent-looking store finding. Store-vs-walk needs no checkout at all and
// therefore cannot go stale, which is the right shape for finding 4: the
// recompute's whole job is to make that equality permanently true. Nothing is
// lost by the change — a port defect is still caught by THE WALK, and a stale
// store is still caught here — what is lost is one cause wearing two hats.
//
// ── RUNNING IT ───────────────────────────────────────────────────────────────
//
//   export WORLD2_PG_URL="postgres://snapshot_reader:…@localhost:5432/world2_dev"
//   git -C ~/world-full checkout settlement/S50
//   node world2/tools/falsifier-standing-equality.mjs --world-repo ~/world-full
//
// `--json` machine-readable · `--idempotence` also asserts that feeding the
// walk's own answer back in does not move it (the constitution shortcut reads
// `data.tier`, the column the recompute writes — standing.mjs proves that is a
// fixpoint, and this checks it) · `--can-fail-proof` mangles the store inside a
// rolled-back transaction and requires each mangle to turn this red, which needs
// a connection that can write.

import { resolve } from "node:path";
import { existsSync, realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { computeStanding, admissionNotes, GEOMETRY_SOURCE } from "./standing.mjs";
import { foldDerivedFor } from "./seed-import.mjs";
import { liveHouseOfVia } from "../../src/household-deriver.mjs";

const arg = (n) => { const i = process.argv.indexOf(n); return i === -1 ? null : process.argv[i + 1]; };
const has = (n) => process.argv.includes(n);
const die = (msg) => { console.error(`CANNOT RUN · ${msg}`); process.exit(2); };

// `submitted_at` rides along from the LOCKING CLAIM (`marks.id` "= the locking
// claim's id", 001_tables.sql) because it is the only receipt that says WHEN a
// mark entered the store — see § the store-only marks. LEFT, not inner: a mark
// with no claim row is exactly the case that must stay visible.
const MARKS_SELECT =
  `SELECT m.id::text, m.slug, m.kind, m.owner, m.household, m.geometry, m.parent::text, m.data, m.status,
          c.submitted_at
     FROM marks m LEFT JOIN claims c ON c.id = m.id
    WHERE m.status = 'standing' ORDER BY m.slug`;

/**
 * The comparison, whole. Separated from the CLI so `--can-fail-proof` can run it
 * against a mangled store without a second copy of the reasoning.
 *
 * `derive` is the fold oracle over the checkout; `records` are the checkout's own
 * loader records, which is what tells us a slug the DB is missing is a CLASS mark
 * (law, and rightly absent) rather than a mark 2.0 lost.
 */
export function standingFindings(rows, { records, derive }, { shadowEra = false, houseOf = null } = {}) {
  const findings = [];
  const attributed = [];
  const born = [];
  // § extended 2026-09-02: under --shadow-era, MEMBERSHIP differences between
  // the two worlds are the writer comparison the era exists to make (the
  // 08-31 parking ruling) — reported in full, never red. Everything that
  // convicts the PORT or the STORE stays red in every era, and a store row
  // with no locking claim stays red in every era too: a mark that never came
  // through the candle is illegitimate regardless of what the git world holds.
  const worldDiff = [];
  const diffPush = (m) => (shadowEra ? worldDiff : findings).push(m);
  // THE WALK THE STORE RUNS, house for house (materialize.mjs § liveHouseOfVia):
  // a port checked without the spelling map would call every row the recompute
  // wrote through it a divergence.
  const walkOf = (rs) => computeStanding(rs, { houseOf });
  const walk = walkOf(rows);
  const byRecordId = new Map(records.map((r) => [r.id, r]));

  // § THE STORE-ONLY MARKS — the register's frontier IN TIME.
  //
  // The latest admission among marks the register DOES hold. A store-only mark
  // admitted after it was born after the state this checkout describes, which is
  // the town working; one admitted at or before it is a mark the checkout should
  // have carried, which is a hole. The frontier is DERIVED from the comparison
  // itself rather than passed in, so it cannot be set to a convenient value.
  //
  // The obvious cheaper key — `locked_window` — was tried first and is WRONG:
  // measured on the live store, window 152 straddles settlement/S47 (the tag is
  // cut at 05:45:16Z, which is that window's own opening), so 4 marks the
  // register holds and 10 it does not share one window number. A frontier on
  // that column would have called those 10 holes. Admission time separates all
  // 848 rows cleanly; the window number cannot.
  const at = (r) => (r.submitted_at ? new Date(r.submitted_at).getTime() : null);
  const knownTimes = rows.filter((r) => byRecordId.has(r.slug)).map(at).filter((t) => t != null);
  const frontier = knownTimes.length ? Math.max(...knownTimes) : null;

  // The ground the oracle cannot see, gathered BEFORE the comparison, because it
  // is the whole of what makes the two states different and therefore the only
  // thing a divergence is allowed to be excused by.
  const storeOnly = rows.filter((r) => !byRecordId.has(r.slug));
  const shared = rows.filter((r) => byRecordId.has(r.slug));
  // The ground the STORE cannot see — the parked-ingest direction (§ extended
  // 2026-09-02). Class marks are law, never rows; errored records never count.
  const inStoreSlugs = new Set(rows.map((r) => r.slug));
  const checkoutOnly = records.filter((r) => !r._error && r.kind !== "class" && !inStoreSlugs.has(r.id));
  // A checkout record expressed as a store-row, so the walk can be run over the
  // oracle's own world. `derive` supplies the resolved household (the fold's
  // answer — never the raw frontmatter, the seed's own correction).
  const rowOfRecord = (rec) => {
    let hh = null;
    try { hh = derive(rec).household; } catch { /* a record the fold cannot answer for adds no ground */ }
    return {
      slug: rec.id, kind: rec.kind, owner: rec.by ?? rec.handle ?? null,
      household: hh, parent: null,
      geometry: (rec.at || rec.extent || rec.points)
        ? { at: rec.at ?? undefined, extent: rec.extent ?? undefined, ...(Array.isArray(rec.points) ? { points: rec.points } : {}) }
        : null,
      data: { tier: null, _parentMarkId: rec._parentMarkId ?? null },
    };
  };
  // All re-walks are LAZY. They cost a full walk each and are consulted only
  // when something actually disagrees, so a green run pays nothing for them.
  let withoutStoreOnly = null;
  const sharedWalk = () => (withoutStoreOnly ??= walkOf(shared));
  let withCheckoutOnly = null;
  const oracleWalk = () => (withCheckoutOnly ??= walkOf([...shared, ...checkoutOnly.map(rowOfRecord)]));
  // Naming the one checkout-only mark whose ADDITION restores agreement —
  // the same courtesy as `culpritFor`, in the other direction, same cap.
  const supplierFor = (slug, foldTier) => {
    if (checkoutOnly.length > CULPRIT_CAP) return null;
    for (const rec of checkoutOnly) {
      if (walkOf([...shared, rowOfRecord(rec)]).get(slug) === foldTier) return rec;
    }
    return null;
  };
  // Naming the culprit: the single store-only mark whose removal restores
  // agreement. Capped, because this is one walk per candidate and the receipt is
  // a courtesy — the attribution itself is decided by `sharedWalk`, not by this.
  const CULPRIT_CAP = 64;
  const culpritFor = (slug, foldTier) => {
    if (storeOnly.length > CULPRIT_CAP) return null;
    for (const s of storeOnly) {
      const without = rows.filter((r) => r.slug !== s.slug);
      if (walkOf(without).get(slug) === foldTier) return s;
    }
    return null;
  };

  let compared = 0;
  for (const row of rows) {
    const rec = byRecordId.get(row.slug);
    if (!rec) {
      // A row the checkout has no record for — the three limbs of § the
      // store-only marks. Never silently skipped in any of them.
      const t = at(row);
      if (t == null)
        findings.push(`store carries ${row.slug}, which the checkout's register does not, AND it has no locking claim ` +
          `— a mark in \`marks\` that never came through the candle is not a mark the town admitted`);
      else if (frontier == null || t <= frontier)
        diffPush(`store carries ${row.slug}, which the checkout's register does not — and it was admitted ` +
          `${new Date(t).toISOString()}, at or before the register's own frontier ` +
          `(${frontier == null ? "unknown" : new Date(frontier).toISOString()}), so the checkout should have carried it`);
      else
        born.push(`${row.slug} (admitted ${new Date(t).toISOString()}, after the register's frontier ` +
          `${new Date(frontier).toISOString()})`);
      continue;
    }
    compared++;
    const foldTier = derive(rec).tier;
    const walkTier = walk.get(row.slug);
    if (walkTier !== foldTier) {
      // § the attribution rule. Does the disagreement survive the removal of the
      // ground the checkout does not have? If not, the two were never answering
      // about the same world at this slug, and the port is not what is wrong.
      const onSharedGround = storeOnly.length ? sharedWalk().get(row.slug) : walkTier;
      if (onSharedGround === foldTier) {
        const who = culpritFor(row.slug, foldTier);
        attributed.push(
          `${row.slug}: the fold says ${foldTier} and the port says ${walkTier}, and the port agrees again ` +
          `(${onSharedGround}) once the ${storeOnly.length} store-only mark(s) are taken away` +
          (who ? `\n    the ground the checkout cannot see: ${who.slug} (${who.kind}, household ${who.household ?? `solo:${who.owner}`})`
                : `\n    no single store-only mark accounts for it on its own — the cause is more than one of them together`));
      } else {
        // § extended 2026-09-02 — the parked-ingest direction: does the port
        // agree once it can see the ground the checkout holds and the store
        // does not?
        const onOracleGround = checkoutOnly.length ? oracleWalk().get(row.slug) : walkTier;
        if (onOracleGround === foldTier) {
          const who = supplierFor(row.slug, foldTier);
          attributed.push(
            `${row.slug}: the fold says ${foldTier} and the port says ${walkTier}, and the port agrees again ` +
            `(${onOracleGround}) once the ${checkoutOnly.length} checkout-only mark(s) are added — ground the store ` +
            `cannot see while the ingest is parked` +
            (who ? `\n    the ground the store cannot see: ${who.id} (${who.kind})`
                  : `\n    no single checkout-only mark accounts for it on its own — the cause is more than one of them together`));
        } else {
          findings.push(`THE WALK disagrees with the fold at ${row.slug}\n    fold says: ${foldTier}\n    port says: ${walkTier}` +
            `\n    and it still disagrees with the store-only ground removed (${onSharedGround}) AND with the ` +
            `checkout-only ground added (${onOracleGround}) — this is the walk, not the two worlds' difference`);
        }
      }
    }
    // Against the WALK, not the fold — see § the same state. This question has
    // no checkout in it and so cannot be answered wrong by a stale one.
    const stored = row.data?.tier ?? null;
    if (stored !== walkTier)
      findings.push(`THE STORE carries a standing the walk does not at ${row.slug}\n    walk says:  ${walkTier}\n    store says: ${stored}`);
  }

  // The other direction: a record the checkout holds and the store does not.
  // CLASS marks are expected — they are law and live in `law_projection`, never
  // in `marks` (the seed's ruling). Anything else is a hole.
  const inStore = new Set(rows.map((r) => r.slug));
  const missing = records.filter((r) => !r._error && r.kind !== "class" && !inStore.has(r.id)).map((r) => r.id);
  for (const slug of missing.slice(0, 10))
    diffPush(`the checkout's register carries ${slug}, which the store does not`);
  if (missing.length > 10) diffPush(`… and ${missing.length - 10} more marks the store does not carry`);

  return { findings, attributed, born, compared, worldDiff, notes: admissionNotes(rows, { houseOf }) };
}

/**
 * The fixpoint assertion. The constitution shortcut reads `mark.tier`, which in
 * 2.0 is `data.tier` — the column the recompute writes. standing.mjs argues that
 * is a fixpoint and not a loop; this makes it a receipt instead of an argument,
 * by writing the answer back in memory and asking again.
 */
export function idempotenceFindings(rows, { houseOf = null } = {}) {
  const first = computeStanding(rows, { houseOf });
  let fed = rows;
  for (let pass = 1; pass <= 3; pass++) {
    fed = fed.map((r) => ({ ...r, data: { ...(r.data ?? {}), tier: first.get(r.slug) } }));
    const again = computeStanding(fed, { houseOf });
    for (const [slug, t] of first)
      if (again.get(slug) !== t)
        return [`the recompute is NOT idempotent: ${slug} was ${t} and became ${again.get(slug)} on pass ${pass} ` +
          `— the constitution shortcut reads the column the recompute writes, and this is the feedback loop ` +
          `standing.mjs claims cannot happen`];
  }
  return [];
}

// THE CLI RUNS ONLY AS THE ENTRY (review-rule.mjs's idiom), so a suite can
// import `standingFindings` and ask it the question the store asks.
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) {
  const worldRepo = arg("--world-repo");
  if (!worldRepo) die("usage: falsifier-standing-equality.mjs --world-repo <checkout> [--json] [--idempotence] [--can-fail-proof]");
  if (!existsSync(resolve(worldRepo))) die(`no checkout at ${worldRepo}`);
  if (!process.env.WORLD2_PG_URL) die("WORLD2_PG_URL missing");

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: process.env.WORLD2_PG_URL });
  try { await client.connect(); } catch (e) { die(`cannot connect: ${e.message}`); }

  let out = {};
  try {
    const { rows } = await client.query(MARKS_SELECT);
    if (!rows.length) die("`marks` holds no standing rows — there is nothing to check, and a falsifier that checked nothing must not report green");

    const oracle = await foldDerivedFor(worldRepo);
    if (!oracle.records.length) die(`the checkout at ${worldRepo} loads no marks`);

    // The checkout's sha, for the report — a green that does not say WHICH state it
    // was green at is a green nobody can reproduce.
    let sha = "?";
    try { sha = execFileSync("git", ["-C", resolve(worldRepo), "rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { /* a non-git checkout still compares */ }

    // The vendor tripwire: `standing.mjs` carries a verbatim copy of the checkout's
    // containment geometry, and a copy is only as good as the day it was taken.
    let geomBlob = null;
    try { geomBlob = execFileSync("git", ["-C", resolve(worldRepo), "rev-parse", `HEAD:${GEOMETRY_SOURCE.path}`], { encoding: "utf8" }).trim(); } catch { /* not a git checkout */ }
    const vendorMoved = geomBlob && geomBlob !== GEOMETRY_SOURCE.blob;

    const shadowEra = has("--shadow-era");
    const houseOf = await liveHouseOfVia(client);
    const { findings, attributed, born, compared, worldDiff, notes } = standingFindings(rows, oracle, { shadowEra, houseOf });
    if (!compared) die("no slug is in both the store and the checkout — the two are not the same world, and an empty comparison is not a pass");

    const idem = has("--idempotence") ? idempotenceFindings(rows, { houseOf }) : [];
    const all = [...findings, ...idem];

    out = {
      world_sha: sha, standing_rows: rows.length, register_records: oracle.records.length,
      compared, findings: all, attributed, born, world_diff: worldDiff, shadow_era: shadowEra, notes,
      vendored_geometry: { ...GEOMETRY_SOURCE, checkout_blob: geomBlob, moved: !!vendorMoved },
    };

    if (has("--can-fail-proof")) {
      const results = [];
      // The victim must be a mark each mangle can actually reach. The first draft
      // took `the first row standing at home`, which was a PREDICATED mark with no
      // geometry — so the "moved 5 km away" mangle updated zero rows and the proof
      // reported the check as silent. A mangle that does not mangle proves nothing,
      // and reading that as "the falsifier missed it" would have been worse than
      // not running it. So: a SITED home mark, which every mangle below can move.
      const victim = rows.find((r) => r.data?.tier === "home" && r.kind === "sited" && r.geometry);
      const parcel = rows.find((r) => r.kind === "parcel");
      if (!victim || !parcel) die("--can-fail-proof needs a sited mark standing at home and a standing parcel; this store has neither");
      // A MANGLE THAT CHANGES NOTHING IS NOT A MANGLE, and reporting its zero
      // findings as "the falsifier did not notice" would be a proof lying in the
      // safe direction — the worst kind. `rowCount` is checked here rather than
      // per-mangle, because the mistake is the harness's to prevent, not each
      // mangle's to remember: the first draft's "moved 5 km away" carried
      // `AND geometry IS NOT NULL` against a de-sited victim, updated no rows, and
      // read as a silent check.
      const mangle = async (label, sql, params = []) => {
        await client.query("BEGIN");
        try {
          const res = await client.query(sql, params);
          if (!res.rowCount) { results.push({ mangle: label, touched: 0, findings: null, first: null }); return; }
          const { rows: mangled } = await client.query(MARKS_SELECT);
          const r = standingFindings(mangled, oracle, { shadowEra, houseOf });
          results.push({ mangle: label, touched: res.rowCount, findings: r.findings.length, first: r.findings[0]?.split("\n")[0] ?? null });
        } finally { await client.query("ROLLBACK"); }
      };
      // 1 · the finding-4 shape itself: a stored standing that no longer matches
      //     the ground. This is the mangle that matters — it is the bug.
      await mangle(`data.tier of ${victim.slug} set to market (the stale-standing shape)`,
        `UPDATE marks SET data = jsonb_set(data, '{tier}', '"market"') WHERE id = $1`, [victim.id]);
      // 2 · the ground moves under a mark: retire a parcel and every mark standing
      //     on it should fall out of home.
      await mangle(`${parcel.slug} retired (the ground leaves)`,
        `UPDATE marks SET status = 'retired' WHERE id = $1`, [parcel.id]);
      // 3 · the grain: a mark handed another household's key.
      await mangle(`household of ${victim.slug} changed (the grain moves)`,
        `UPDATE marks SET household = 'gh:000000' WHERE id = $1`, [victim.id]);
      // 4 · the ground moves geometrically: a mark walked off its own parcel.
      await mangle(`geometry of ${victim.slug} moved 5 km away`,
        `UPDATE marks SET geometry = jsonb_set(geometry, '{at}', '{"x": 5000, "y": 5000}'),
                          bbox = box(point(4990, 4990), point(5010, 5010))
           WHERE id = $1`, [victim.id]);
      // 5 · a mark the register does not hold.
      await mangle("a forged mark inserted",
        `INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, data)
         SELECT gen_random_uuid(), 'forged/not-a-real-mark', kind, owner, household, body,
                jsonb_set(geometry, '{at}', '{"x": 9000, "y": 9000}'),
                box(point(8987.5, 8987.5), point(9012.5, 9012.5)), 'standing', locked_window, data
           FROM marks WHERE id = $1`, [parcel.id]);

      const after = standingFindings((await client.query(MARKS_SELECT)).rows, oracle, { shadowEra, houseOf });
      out.can_fail = {
        results, restored: after.findings.length === 0,
        silent: results.filter((r) => r.findings === 0).map((r) => r.mangle),
        inert: results.filter((r) => r.touched === 0).map((r) => r.mangle),
      };
    }
  } catch (err) {
    die(err.message);
  } finally {
    await client.end();
  }

  if (has("--json")) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`world ${out.world_sha?.slice(0, 8)} · ${out.standing_rows} standing rows vs ${out.register_records} register records · ${out.compared} compared`);
    if (out.vendored_geometry.moved)
      console.log(`  ⚑ the vendored geometry's source has moved: ${GEOMETRY_SOURCE.path} is ${out.vendored_geometry.checkout_blob?.slice(0, 8)} in this checkout, ` +
        `${GEOMETRY_SOURCE.blob.slice(0, 8)} when standing.mjs vendored it — re-check the copy`);
    for (const n of out.notes) console.log(`  ⚑ ${n}`);
    // Printed BEFORE the findings and never folded into them: an attributed
    // divergence is a real difference between the two answers, and the reader is
    // owed it. What it is not is evidence against the port.
    for (const a of out.attributed ?? [])
      console.log(`  ~ ATTRIBUTED to the two worlds' difference · ${a}`);
    if (out.born?.length) {
      console.log(`  · ${out.born.length} mark(s) born after the register's frontier — the town moved on, which is not a divergence:`);
      for (const b of out.born) console.log(`      ${b}`);
    }
    if (out.world_diff?.length) {
      console.log(`  ≠ WORLD DIFF, ${out.world_diff.length} row(s) — the writer comparison the shadow era exists to make (--shadow-era; the parking ruling, 2026-08-31). Reported, never red:`);
      for (const w of out.world_diff) console.log(`      ${w}`);
    }
    for (const f of out.findings) console.log(`  ✗ ${f}`);
    if (out.can_fail) {
      console.log("\ncan-fail proof:");
      for (const r of out.can_fail.results)
        console.log(r.touched === 0
          ? `  INERT  mangle changed no row: ${r.mangle} — this proves nothing and is a defect in the proof`
          : `  ${r.findings ? "RED  " : "SILENT"} after mangle: ${r.mangle} (${r.touched} row) — ${r.findings} finding(s)${r.first ? `\n         ${r.first}` : ""}`);
      console.log(`  ${out.can_fail.restored ? "GREEN" : "RED"} after rollback — the mangles left ${out.can_fail.restored ? "no trace" : "A TRACE"}`);
      console.log(out.can_fail.silent.length || out.can_fail.inert.length || !out.can_fail.restored
        ? `  can-fail NOT PROVEN: ${out.can_fail.silent.length} mangle(s) went unnoticed, ${out.can_fail.inert.length} changed nothing`
        : "  can-fail PROVEN: every mangle turned the falsifier red, and rollback restored green");
    }
    const tail = (out.attributed?.length ? `, with ${out.attributed.length} divergence(s) attributed to the two worlds' difference` : "")
      + (out.world_diff?.length ? ` · ${out.world_diff.length} world-diff row(s) reported` : "");
    console.log(out.findings.length
      ? `\nRED · ${out.findings.length} finding(s)${tail}`
      : `\nGREEN · the port, the fold and the store agree on every slug the two states share${tail}`);
  }
  if (out.can_fail && (out.can_fail.silent.length || out.can_fail.inert.length || !out.can_fail.restored)) process.exit(1);
  process.exit(out.findings.length ? 1 : 0);
}
