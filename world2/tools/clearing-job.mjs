// clearing-job.mjs — THE CANDLE'S CLOSE. One transaction per window.
//
// LAW (gold §1, verbatim): "The clearing's transitions are the sweep's existing
// outcomes, renamed: published → locked (materialized) · unpublished/quarantined
// → refused with the failing check named (attributable by construction; the
// isolation pass dies) · dropped/the-already-standing → refused-duplicate ·
// withdrawn → retracted · left_drafted → stays pending · rebased → ceases to
// exist (git mechanics, not a decision)."
//
// LAW (census.md Decision 2, verbatim): "Competing claims on the same ground in
// one window: neither locks; both held for REVIEW (a mind rules). Stake-weight
// is advisory context, never an auto-win."
//
// LAW (census.md seams amendment): stamp ingest runs "again as clearing_job's
// first step" at window close, then the window pins law_sha + town_sha —
// outcomes reproducible from (claims, law_sha, town_sha).
//
// LAW (Wright's ruling on the replay gate's finding 4, 2026-08-28 eve, verbatim):
// "tier is recomputed for ALL standing marks inside the clearing transaction,
// which is settlement-equivalent staleness, zero new class" — the cadence being
// 1.0's own, "derived weight moves at the next Settlement" (ECONOMY-DIALS
// read_side). That is step 7, the window's last act; the walk lives in
// standing.mjs and `falsifier-standing-equality.mjs` holds it to 1.0's fold.
//
// PEN: connects as clearing_job — the ONLY role transitioning claims,
// writing windows, and materializing marks (gold §3 rule 2). The stamp ingest
// first-step runs as law_ingester (its own pen) BEFORE this transaction; this
// tool shells to stamp-ingest.mjs for it rather than borrowing its grants.
//
// LAW (Keemin, postmark#2594, ruled 2026-09-08 and RE-RULED the same evening on
// the reviewer's measurement): the canon-absent check is NOT at this lock step.
// The crossing's own settlement pushes its mark files to origin three to four
// minutes AFTER this job clears the window — seven consecutive crossings
// measured, never once before — so a canon check here refuses the marks its own
// crossing just locked. It lives on the nightly read instead
// (`falsifier-canon-locks.mjs`, the notary rail) and becomes structurally
// impossible at the G1 swap. What DOES belong here is step 5.5: the escrow
// PRESENCE rule, which reads the town and races nothing.
//
// Usage (box):
//   node world2/tools/clearing-job.mjs --window <N> \
//     [--town-repo <checkout>]        # when given: stamp-ingest first (the census first-step)
//     [--dry-run]                     # compute + print transitions, commit nothing
//   env: WORLD2_CLEARING_URL = postgres://clearing_job:...@localhost/world2_dev
//        WORLD2_INGEST_URL   = postgres://law_ingester:... (only with --town-repo)
//
// The next window opens in the same transaction (id N+1, 12h span) — the candle
// never leaves the town without an open window.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// Steps 6 and 7's law, extracted the day the REVIEW lane became a second tool
// holding the same `clearing_job` pen (`review-rule.mjs`). One definition, two
// callers — see materialize.mjs's header for why it is not a copy.
import { materializeClaims, recomputeStanding, slugOf, ownerHouseholdFor } from "./materialize.mjs";
// The escrow PRESENCE gate — the sweep's own rule, ported to the candle before
// G1 deletes the path it lives on. See step 5.5.
import { escrowAbsentAmong, escrowPresenceAt, escrowLines } from "./escrow-presence.mjs";
// THE PARCEL CAP — the sweep's own gate, ported to the candle before the sweep
// has to be the one to say no. The law itself is the WORLD's and is imported
// from a checkout, never copied. See step 5.6.
import { parcelCapLawAt, parcelCapRefusals, parcelCapLines, heldParcelsByCred, credOf, soloCountedAt, countingSolo } from "./parcel-cap.mjs";
import { houseRowsVia, resolveHouse } from "../../src/household-deriver.mjs";
import { computeStanding, gistContainment } from "./standing.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (n) => { const i = process.argv.indexOf(n); return i === -1 ? null : process.argv[i + 1]; };
const has = (n) => process.argv.includes(n);

const windowId = Number(arg("--window"));
if (!Number.isInteger(windowId)) { console.error("usage: clearing-job.mjs --window <N> [--town-repo <checkout>] [--world-repo <checkout>] [--dry-run]"); process.exit(2); }
// THE WORLD CHECKOUT THE PARCEL CAP IS READ FROM, by argument and not by env.
//
// `WORLD_CLONE` lives in /etc/postmark-office.env and this unit does not read
// that file — measured on the box: postmark-world2-clearing.service carries
// EnvironmentFile=/etc/postmark-world2-dev.env and -/etc/postmark-world2-clearing.env
// and one Environment= line (WORLD2_OFFICE). So an env key would have been
// silently absent, and a cap gate that silently does not run is worse than no
// cap gate at all. The runner passes the lab's own ingest clone, exactly as it
// already passes --town-repo, and exactly as the notary already hands
// falsifier-canon-locks.mjs a --world-repo.
const worldRepo = arg("--world-repo");
if (!process.env.WORLD2_CLEARING_URL) { console.error("WORLD2_CLEARING_URL missing (role clearing_job)"); process.exit(2); }

// ── first step: the stamp ingest (census amendment), its own pen ─────────────
const townRepo = arg("--town-repo");
if (townRepo && !has("--dry-run")) {
  const sha = execFileSync("git", ["-C", townRepo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  execFileSync(process.execPath, [join(HERE, "stamp-ingest.mjs"), "--town-repo", townRepo, "--sha", sha],
    { stdio: "inherit", env: { ...process.env, WORLD2_PG_URL: process.env.WORLD2_INGEST_URL } });
}

const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString: process.env.WORLD2_CLEARING_URL });
await client.connect();

const q = (text, args = []) => client.query(text, args);

// bbox overlap in SQL: the same operator the marks exclusion constraint uses,
// so the clearing and the constraint can never disagree about "overlaps".
const OVERLAP = "a.bbox && b.bbox";

try {
  await q("BEGIN");

  // The window, locked against a concurrent close (one clearing at a time).
  const { rows: [win] } = await q(
    "SELECT * FROM windows WHERE id = $1 AND status = 'open' FOR UPDATE", [windowId]);
  if (!win) throw new Error(`window ${windowId} is not open (already cleared, or never opened)`);

  await q("UPDATE windows SET status = 'clearing' WHERE id = $1", [windowId]);

  // Pin the shas the outcome is computed against (determinism, gold §3 rule 2).
  const { rows: heads } = await q("SELECT repo, sha FROM projection_heads");
  const lawSha = heads.find((h) => h.repo === "world-law")?.sha ?? null;
  const townSha = heads.find((h) => h.repo === "town")?.sha ?? null;

  const { rows: pending } = await q(
    "SELECT * FROM claims WHERE window_id = $1 AND status = 'pending' ORDER BY submitted_at, id", [windowId]);

  // A clearing that cannot say what it computed against must not compute
  // (states-with-no-receipt): staked claims need a town pin, and every claim
  // needs law. Found live 2026-08-28 — an empty projection priced a real
  // resident's stamps at zero instead of refusing to run.
  if (pending.some((c) => (c.stake ?? 0) > 0) && !townSha)
    throw new Error("no town projection head — staked claims cannot be judged without a pinned stamp read; run stamp-ingest first (the census first-step)");
  if (pending.length && !lawSha)
    throw new Error("no world-law projection head — a clearing computes against law-as-of a sha; run law-ingest first");
  const outcomes = new Map(); // id -> { status, refusal_check }
  const decide = (id, status, check = null) => outcomes.set(id, { status, refusal_check: check });

  // 1 · refused-duplicate: "dropped/the-already-standing → refused-duplicate".
  //     A claim whose slug already stands (same slug in marks, standing).
  //
  //     AN AMEND IS NOT A DUPLICATE, and the distinction is the whole of finding 2.
  //     Found live 2026-08-28 by the replay gate: settlement/S49 published 14
  //     claims, four of them amendments of standing marks (vellix/casa-nera,
  //     vermillion's three space-program marks), and every one was refused here as
  //     `duplicate: a standing mark already carries this slug`. 1.0 publishes
  //     amendments — the sweep restamps `date` and rewrites the record — so a 2.0
  //     that refuses them cannot reach 1.0's state and the cutover cannot pass.
  //
  //     `supersedes` is already the column for it (001: "amend-chain resolution,
  //     #1697/#1862 class"); what was missing is that step 2 below only ever read
  //     it WITHIN the window. A claim that supersedes a claim from an EARLIER
  //     window is an amendment of what that claim locked, and it is exactly the
  //     one case where a slug that already stands is not a collision.
  const amends = new Map();   // claim id -> the standing mark it continues
  for (const c of pending) {
    const slug = slugOf(c);
    if (!slug) continue;
    const { rows } = await q(
      "SELECT id::text, locked_window FROM marks WHERE slug = $1 AND status = 'standing' AND id <> $2",
      [slug, c.id]);
    if (!rows.length) continue;
    if (c.supersedes && String(c.supersedes) === rows[0].id) { amends.set(String(c.id), rows[0]); continue; }
    decide(c.id, "refused",
      c.supersedes
        ? `duplicate: a standing mark carries this slug, and this claim supersedes ${String(c.supersedes).slice(0, 8)}, which is not it`
        : "duplicate: a standing mark already carries this slug");
  }

  // 2 · supersession: a claim superseded by a later claim in the SAME window
  //     ceases to compete — the chain's head is what clears ("rebased → ceases
  //     to exist" is git-era; the amend-chain is its 2.0 face, P-004).
  const superseded = new Set(pending.filter((c) => c.supersedes).map((c) => String(c.supersedes)));
  for (const c of pending) {
    if (superseded.has(String(c.id)) && !outcomes.has(c.id))
      decide(c.id, "refused", "superseded: a later claim in this window amends this one");
  }
  // The other half of the amend chain — a claim superseding a mark that locked in
  // an EARLIER window — is resolved above, in step 1, where the collision it looks
  // like is decided. Both halves read the same column; only the scope differs.

  // 3 · escrow sufficiency at town_sha (the pinned candle read).
  //     LIQUID balance (merge ruling 2 in world2/tools/README.md).
  const staked = new Map(); // claimant -> total stake this window
  for (const c of pending) if (!outcomes.has(c.id)) staked.set(c.claimant, (staked.get(c.claimant) ?? 0) + (c.stake ?? 0));
  for (const [claimant, total] of staked) {
    if (total === 0) continue;
    const { rows: [bal] } = await q(
      "SELECT balance FROM stamp_projection WHERE town_sha = $1 AND handle = $2", [townSha, claimant]);
    if ((bal?.balance ?? 0) < total) {
      for (const c of pending)
        if (c.claimant === claimant && !outcomes.has(c.id) && (c.stake ?? 0) > 0)
          decide(c.id, "refused", `insufficient-stamps: staked ${total}, liquid ${bal?.balance ?? 0} at town ${townSha?.slice(0, 8) ?? "?"}`);
    }
  }

  // 4 · geometry vs STANDING marks: a parcel claim overlapping standing parcel
  //     ground is refused with the check named — the standing mark wins;
  //     contesting a standing mark is REVIEW's lane, not the candle's.
  for (const c of pending) {
    if (outcomes.has(c.id) || c.class !== "parcel" || !c.bbox) continue;
    // A parcel amending ITSELF overlaps its own standing ground by definition, and
    // that is not a collision with anyone — the mark it is superseding is the one
    // it replaces. Excluding it is the same exception step 1 makes, asked of the
    // geometry instead of the slug.
    const self = amends.get(String(c.id))?.id ?? null;
    const { rows } = await q(
      `SELECT b.slug FROM marks b, (SELECT bbox FROM claims WHERE id = $1) a
       WHERE b.kind = 'parcel' AND b.status = 'standing' AND ${OVERLAP}
         AND ($2::uuid IS NULL OR b.id <> $2::uuid) LIMIT 1`, [c.id, self]);
    if (rows.length) decide(c.id, "refused", `parcel-overlap: standing parcel "${rows[0].slug}"`);
  }

  // 5 · geometry vs THE WINDOW'S OTHER CLAIMS: the counterclaim rule (D2).
  //     "neither locks; both held for REVIEW".
  const survivors = pending.filter((c) => !outcomes.has(c.id));
  for (let i = 0; i < survivors.length; i++) {
    for (let j = i + 1; j < survivors.length; j++) {
      const a = survivors[i], b = survivors[j];
      if (a.class !== "parcel" || b.class !== "parcel" || !a.bbox || !b.bbox) continue;
      const { rows } = await q(
        `SELECT 1 FROM (SELECT bbox FROM claims WHERE id = $1) a,
                      (SELECT bbox FROM claims WHERE id = $2) b WHERE ${OVERLAP}`, [a.id, b.id]);
      if (rows.length) {
        decide(a.id, "held_review", `counterclaim: collides with ${b.id} — a mind rules (census D2)`);
        decide(b.id, "held_review", `counterclaim: collides with ${a.id} — a mind rules (census D2)`);
      }
    }
  }

  // 5.5 · A COMMONS MARK NEEDS SOMEBODY'S STAMPS BEHIND IT (postmark#2594's
  //     second half; ruled a G1 blocker 2026-09-08 after lane 2's reviewer found
  //     it by receipt).
  //
  //     Step 3 above is an AFFORDABILITY test and says so — `if (total === 0)
  //     continue`. A claim staking zero has never been looked at. The 1.0 sweep
  //     is where the PRESENCE rule lives (`settlement-sweep.mjs:1146-1152`,
  //     "commons needs escrow > 0"), and G1 deletes the sketchbook path that
  //     carries it, so after the cutover the rule stops being enforced anywhere
  //     unless it is here.
  //
  //     THE CLASS IS COMPUTED, NOT READ. `marks.data.tier` is written by
  //     `recomputeStanding` at step 7, AFTER materialization — at this point the
  //     mark does not exist and the column is null, so a gate reading it would
  //     judge every claim as classless and refuse nothing, forever. The port's
  //     own walk answers prospectively over the standing rows PLUS the candidate
  //     rows, in the shape `materializeClaims` is about to insert. One definition
  //     of standing, used twice.
  //
  //     OWN GROUND IS EXEMPT WITHOUT A CLAUSE: the class rule answers `home` for
  //     a mark on its own household's ground (`mark-standing.mjs § groundVerdict`,
  //     ported in `standing.mjs`), and only `commons` needs escrow. Writing an
  //     own-ground exception here would be a second copy of a law, and copies
  //     drift.
  //
  //     AND IT DEGRADES LOUDLY RATHER THAN EITHER WAY SILENTLY. `escrow_projection`
  //     is migration 014, which arrives with lane 2 (`jetto/g1-render-stakes`);
  //     until it lands, `escrowPresenceAt` answers null and every commons claim
  //     is reported UNCHECKED and locks. It is not read as "nobody staked" —
  //     that would refuse the whole town on a missing migration — and it is not
  //     silent: the crossing prints it and the nightly read carries the class.
  //     (If the conductor would rather the crossing REFUSE while it cannot check,
  //     that is this block's `if (escrow.unchecked.length)` arm and one throw.)
  let escrowSeen = null;
  {
    const undecidedNamed = pending.filter((c) => !outcomes.has(c.id) && slugOf(c));
    if (undecidedNamed.length) {
      const { rows: standingRows } = await q(
        `SELECT id::text, slug, kind, owner, household, geometry, parent::text, data
           FROM marks WHERE status = 'standing'`);
      const candidates = [];
      for (const c of undecidedNamed) {
        candidates.push({
          id: String(c.id), slug: slugOf(c), kind: c.class, owner: c.claimant,
          household: await ownerHouseholdFor(q, c.claimant),
          geometry: c.geometry, parent: c.parent, data: c.data,
        });
      }
      //   ONE FULL WALK PER CROSSING, and this is not it. The whole world is
      //   still resolved — a candidate's standing depends on ground it does not
      //   own — but the ANSWERS this gate needs are the candidates' and nothing
      //   else: `escrowAbsentAmong` reads `tiers.get(c.slug)` for exactly the
      //   claims handed to it three lines below. Naming that set turns the walk
      //   from a pass over the register into a climb up the candidates' own
      //   ancestry, and leaves `recomputeStanding` at step 7 as the crossing's
      //   single all-marks walk (standing.mjs § `only`).
      //
      //   The slug set is `candidates`' own, which is `undecidedNamed` mapped
      //   through the same `slugOf` — one derivation, so the two cannot drift
      //   into a gate that quietly checks nothing.
      //
      //   The containment candidates come from the store's own GiST
      //   (standing.mjs § the spatial index). The CLAIMS in this set are not in
      //   `marks` and no index has seen them, which is not a gap: the reader
      //   hands back the set it can speak for, and the walk keeps scanning the
      //   long way for everything else — including, deliberately, every one of
      //   these candidates.
      const containment = await gistContainment(q);
      const tiers = computeStanding([...standingRows, ...candidates],
        { only: new Set(candidates.map((c) => c.slug)), containment });
      const escrowByMark = await escrowPresenceAt(q, { townSha });
      const verdict = escrowAbsentAmong(
        undecidedNamed.map((c) => ({ id: c.id, slug: slugOf(c) })),
        { tiers, escrowByMark, townSha });
      escrowSeen = {
        commons: verdict.commons.length,
        refused: verdict.refused.map((r) => r.slug),
        unchecked: verdict.unchecked.map((c) => c.slug),
        town_sha: townSha,
      };
      for (const r of verdict.refused) decide(r.id, "refused", r.check);
      // The strings are composed by `escrowLines`, not here, because this file is
      // a script and a line composed here is watched by nothing — which is how
      // the first cut of the UNCHECKED line came to print `[object Object]` over
      // an array of candidate objects while its sibling and the receipt both
      // mapped to `.slug` correctly.
      for (const line of escrowLines(verdict, townSha)) console.log(`  ⚑ ${line}`);
    }
  }

  // 5.6 · THE PARCEL CLAIM CAP — the sweep's gate, asked at the close (POS-98).
  //
  //     THE INSTANCE: window 191 cleared and LOCKED `mari/marigold-house-parcel`
  //     at 2026-09-15T17:45:46Z. The sweep, three minutes later, refused it —
  //     the cap counts per credential household, hers resolves to the founder's,
  //     and that one held five. The store stood the parcel while canon lacked
  //     it, and every crossing since has carried it forward as canon-absent
  //     ("CARRIED 1 canon-absent mark(s) from earlier window(s):
  //     mari/marigold-house-parcel", windows 192, 193, 194 on the box).
  //
  //     Two gates, two answers. The candle admitted what the sweep would refuse
  //     because steps 1-5.5 above ask about slugs, supersession, escrow and
  //     geometry, and none of them counts a household's parcels.
  //
  //     LAST OF THE GATES, deliberately. A claim already refused for overlap or
  //     held for a counterclaim must not consume a household's headroom — it is
  //     not getting ground this window either way, and spending the cap on it
  //     would refuse a sibling claim that should have stood.
  //
  //     THE SWEEP'S OWN CHECK IS UNTOUCHED. It stays as the gate of last resort:
  //     this side reads the store and the sweep reads the tree, and the day they
  //     disagree the conservative one is the one that should win.
  //
  //     AND IT DEGRADES LOUDLY RATHER THAN EITHER WAY SILENTLY — the same shape
  //     step 5.5 above already argues for itself. Without `--world-repo` (or with
  //     a checkout that cannot answer) the cap is reported UNCHECKED and parcel
  //     claims lock as they did before this step existed. It is not read as "the
  //     cap is 0", which would refuse every parcel in the town on a missing
  //     argument, and it is not silent: the crossing prints it and the window's
  //     receipt carries it. (If the conductor would rather the crossing REFUSE
  //     while it cannot check, that is this block's `unchecked` arm and one throw.)
  let capSeen = null;
  {
    const parcels = pending.filter((c) => !outcomes.has(c.id) && c.class === "parcel" && slugOf(c));
    if (parcels.length) {
      let law = null;
      let why = null;
      if (!worldRepo) why = "no --world-repo was given, so the world's cap could not be read";
      else {
        try { law = await parcelCapLawAt(worldRepo); }
        catch (err) { why = err.message; }
      }
      if (!law) {
        capSeen = { checked: false, reason: why, claims: parcels.map((c) => slugOf(c)) };
        console.log(`  ⚑ parcel cap: ${parcels.length} parcel claim(s) LOCKED UNCHECKED — ${why}`);
      } else {
        // ONE HOUSE, HOWEVER ITS ROWS ARE SPELLED (POS-160 RULING 4). The store
        // never re-spells a row, so both sides of this gate fold through the
        // deriver on the way in: the STANDING counts in `heldParcelsByCred` and
        // each CANDIDATE's `cred` below, by the same rule (`credOf`). Folding
        // one side only would make every lookup miss and refuse nothing.
        const houseRows = await houseRowsVia({ query: q });
        const walked = (hh) => resolveHouse(hh, houseRows.registry, houseRows.pins).slug;
        // POS-212: `solo:` rows COUNT only once the adoption batch has run on
        // this store (the `solo-counted` act) — never before. See parcel-cap.mjs
        // § THE COUNT AFTER ADOPTION.
        const soloCounted = await soloCountedAt(q);
        const resolve = soloCounted ? countingSolo(walked, houseRows.registry, houseRows.pins) : walked;
        const heldByCred = await heldParcelsByCred(q, { resolve });
        const candidates = [];
        for (const c of parcels) {
          candidates.push({
            id: c.id, slug: slugOf(c),
            cred: credOf(await ownerHouseholdFor(q, c.claimant), resolve),
            // The RECORD's own date, which is what the fold compares against the
            // law date — never `submitted_at`. The drain queue dates a parcel at
            // seating and the two are different facts; the exceptions map exists
            // precisely because they can disagree.
            date: c.data?.date ?? null,
            // An amendment of a parcel the household already holds is a
            // relocation, not a second claim (POS-88, and marks-fold.mjs's own
            // `!mk._replacing`). Step 1 above already resolved which claims those
            // are, into `amends`.
            amending: amends.has(String(c.id)),
          });
        }
        const verdict = parcelCapRefusals(candidates, { heldByCred, law });
        capSeen = {
          checked: true, cap: law.cap, law_date: law.lawDate, world_sha: law.sha, solo_counted: soloCounted,
          refused: verdict.refused.map((r) => ({ slug: r.slug, held: r.held })),
          excepted: verdict.admitted.filter((a) => a.excepted).map((a) => a.slug),
          judged: candidates.length,
        };
        for (const r of verdict.refused) decide(r.id, "refused", r.check);
        for (const line of parcelCapLines(verdict, law)) console.log(`  ⚑ ${line}`);
      }
    }
  }

  // 6 · everything still undecided LOCKS and materializes. The materialization
  //     itself is `materialize.mjs`'s — the same code the REVIEW lane's ruling
  //     runs, so a mark that arrives by a mind's ruling and one that arrives by
  //     the candle are the same row shape by construction.
  const sixCount = { locked: 0, refused: 0, held_review: 0, retracted_before_close: 0, pending_carried: 0 };
  const materialize = [];
  for (const c of pending) {
    const o = outcomes.get(c.id) ?? { status: "locked", refusal_check: null };
    await q("UPDATE claims SET status = $2, refusal_check = $3, decided_at = now() WHERE id = $1",
      [c.id, o.status, o.refusal_check]);
    sixCount[o.status === "locked" ? "locked" : o.status === "held_review" ? "held_review" : "refused"] += 1;
    if (o.status !== "locked") continue;
    materialize.push(c);
  }

  await materializeClaims(q, { claims: materialize, amends, windowId, label: `window ${windowId}` });

  const { rows: [{ count: retracted }] } = await q(
    "SELECT COUNT(*)::int AS count FROM claims WHERE window_id = $1 AND status = 'retracted'", [windowId]);
  sixCount.retracted_before_close = retracted;

  // 7 · THE STANDING RECOMPUTE — the window's last act, after everything this
  //     window materialized is in the register.
  //
  //     RULING (Wright, 2026-08-28 eve, on the replay gate's finding 4):
  //     "tier = recompute-at-close, per the dials' own cadence ('derived weight
  //      moves at the next Settlement'); the standing walk ports as a spatial
  //      query; the replay gate is the judge."
  //
  //     The finding it closes: "`data.tier` is not a field of the record — it is
  //     what the fold says after resolving the whole world, and 1.0 recomputes it
  //     for all 960 records at every settlement. 2.0 writes it once, at
  //     materialization, and never revisits it."
  //
  //     ALL STANDING MARKS, not this window's. That is the whole point: standing
  //     is a fact about the ground a mark stands on, so a NEIGHBOUR's parcel
  //     landing in this window moves marks nobody claimed —
  //     `berthillon/le-petit-berthillon` went `market → home` with every authored
  //     byte identical, because `berthillon/chez-antoine` gave the walk sovereign
  //     ground to stop at.
  //
  //     INSIDE THIS TRANSACTION, because a recompute that could land after the
  //     window closed would be a second pen writing the register, and the
  //     determinism property ("every window's outcome is reproducible from
  //     (claims, law_sha, town_sha)") would stop being true of `marks`.
  //
  //     ONLY THE ROWS THAT MOVED are written, and the count is a receipt: a
  //     recompute that touched every row every window would tell a reader nothing
  //     about whether the world moved.
  //
  //     The walk itself is `materialize.mjs`'s, shared with the REVIEW lane for
  //     the same reason step 6 is: a ruling that grants ground has to move the
  //     neighbours' standing exactly as a clearing does.
  const { standing, moved, notes, containment: containmentSeen } = await recomputeStanding(q);
  for (const n of notes) console.log(`  ⚑ standing: ${n}`);

  // Close, pin, open the successor.
  //
  // `receipts` is REPLACED, so anything already written there has to be carried
  // forward by name. Today that is `review_rulings` — a mind's ruling on a
  // `held_review` contest lands on the OPEN window's receipts as it happens
  // (`review-rule.mjs`), and this UPDATE would otherwise erase the record of a
  // decision the town made inside this window. A receipt a later write silently
  // drops is worse than one nobody wrote.
  const carried = Array.isArray(win.receipts?.review_rulings) ? win.receipts.review_rulings : null;
  await q(
    `UPDATE windows SET status = 'closed', cleared_at = now(), law_sha = $2, town_sha = $3, receipts = $4
     WHERE id = $1`,
    [windowId, lawSha, townSha, JSON.stringify({
      six_count: sixCount,
      ...(carried ? { review_rulings: carried } : {}),
      computed_against: { law_sha: lawSha, town_sha: townSha },
      // The escrow gate's own account, including what it could NOT check — a
      // crossing that locked commons claims unchecked must say so on the record
      // and not only on a console nobody kept.
      ...(escrowSeen ? { escrow_presence: escrowSeen } : {}),
      // THE PARCEL CAP's own account, including the crossing that could not ask
      // it. Same rule as the escrow gate one line up: a window that locked parcel
      // claims unchecked must say so on the record and not only on a console
      // nobody kept. `world_sha` is here because a gate that refuses a resident's
      // ground has to name the law-as-of it refused against.
      ...(capSeen ? { parcel_cap: capSeen } : {}),
      standing: {
        recomputed: standing.length, moved: moved.length,
        // Capped, because the receipt is evidence and not an export: the first
        // recompute over a freshly floored store can move hundreds of rows, and a
        // window row is not where that list belongs. The count is exact.
        moves: moved.slice(0, 25),
        // What the containment index could speak for (016_marks_bbox_gist.sql).
        // `indexed: false` is a crossing that paid the old price for the walk
        // because the migration is not applied — the one state that otherwise
        // shows up nowhere but the clock.
        containment: containmentSeen,
        ...(notes.length ? { notes } : {}),
      },
    })]);
  await q(
    `INSERT INTO windows (id, opens_at, closes_at, status)
     VALUES ($1, $2, $2::timestamptz + interval '12 hours', 'open')
     ON CONFLICT (id) DO NOTHING`,
    [windowId + 1, win.closes_at]);

  if (has("--dry-run")) {
    await q("ROLLBACK");
    console.log(`DRY RUN window ${windowId}: ${JSON.stringify(sixCount)}; standing recomputed over ${standing.length}, ${moved.length} moved (rolled back)`);
  } else {
    await q("COMMIT");
    console.log(`CLEARED window ${windowId} @ law ${lawSha?.slice(0, 8) ?? "∅"} town ${townSha?.slice(0, 8) ?? "∅"}: ${JSON.stringify(sixCount)}; standing recomputed over ${standing.length} mark(s), ${moved.length} moved${moved.length ? ` (${moved.slice(0, 3).map((m) => `${m.slug} ${m.from}→${m.to}`).join(", ")}${moved.length > 3 ? ", …" : ""})` : ""}; window ${windowId + 1} open`);
  }
} catch (err) {
  await q("ROLLBACK").catch(() => {});
  console.error(`CLEARING FAILED window ${windowId}: ${err.message} — nothing moved (one transaction, gold §1: "a transaction instead of a rebase pipeline that wedges when a process dies")`);
  process.exit(1);
} finally {
  await client.end();
}
