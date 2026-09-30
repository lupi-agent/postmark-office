// review-rule.mjs — THE VERB `held_review` NEVER HAD. One transaction per ruling.
//
// LAW (census.md Decision 2, verbatim): "Competing claims on the same ground in
// one window: neither locks; both held for REVIEW (a mind rules). Stake-weight
// is advisory context, never an auto-win."
//
// `clearing-job.mjs` step 5 puts claims into `held_review`. Until this file
// nothing took them out: the one state in the six-count that no pen could move,
// so a contested parcel sat on a closed window's docket forever wearing a status
// that promised a decision nobody could record. A state a system can enter and
// never leave is not a lifecycle stage — it is a hole with a name.
//
// ── WHY AN OPERATOR TOOL AND NOT A DOOR ─────────────────────────────────────
//
// Three reasons, and the first one is the substrate refusing:
//
//   1. THE PEN. Transitioning a claim is `clearing_job`'s grant and nobody
//      else's (002_grants.sql), and `claims_update_guard` exempts exactly that
//      role: "office_api's claims UPDATE is retraction only". An endpoint served
//      by `office_api` could not do this if it wanted to, and giving the door
//      the clearing pen so that it could would hand the candle's whole authority
//      to the surface with the widest attack area.
//   2. IT IS NOT A RESIDENT VERB. A resident cannot rule their own contest, and
//      a resident cannot rule someone else's. There is no grant in
//      `law_projection` for it and there should not be: the sixteen grants are
//      what the law affords residents, and "settle a contest between two
//      residents" is the office's act, in the lane the census already names
//      REVIEW.
//   3. THE PRECEDENT IS IN THIS DIRECTORY. `world2/tools/README.md` § The pens:
//      "The REVIEW lane — 'a mind clears it' — lives entirely in the GitHub PR
//      flow, where a grant widening is visible in a diff. Nothing in this
//      directory decides anything." That sentence is about LAW review, and this
//      is the CLAIMS half of the same lane: a mind decides, and the tool only
//      records what the mind decided. Every judgement here comes in on the
//      command line — `--by`, `--rule`, `--because` — and this file computes
//      none of it.
//
// A keyed endpoint was considered and refused for reason 1: it would need the
// clearing credential to exist behind the office's HTTP surface at all times, in
// exchange for saving a mind one ssh.
//
// ── WHY THE RULING MATERIALIZES RATHER THAN RE-DOCKETING ────────────────────
//
// The obvious cheaper design is to put the winner back to `pending` in the open
// window and let the ordinary candle lock it. It is wrong, and the reason is
// worth keeping: a claim's escrow sufficiency was judged at ITS window's
// `town_sha` (step 3), and re-pending it would have the next candle re-judge it
// at a different one. The candle would then be able to REFUSE a claim a mind had
// already granted — stake-weight overturning the mind, which is the exact thing
// Decision 2's last sentence forbids. A mind's ruling is terminal by law, so it
// is terminal here.
//
// What it does NOT get to do is rule on a world that has moved. Between the hold
// and the ruling another window may have locked the slug or the ground, so both
// checks are re-run at ruling time — and a failure REFUSES THE RUN rather than
// refusing the claim. A mind ruled on facts that have changed; that wants the
// mind again, not this tool's guess.
//
// ── THE MATERIALIZATION IS THE CANDLE'S OWN ─────────────────────────────────
//
// `materialize.mjs`, imported — the same `materializeClaims` and
// `recomputeStanding` `clearing-job.mjs` steps 6 and 7 call, extracted rather
// than copied. A mark that arrives by a ruling and a mark that arrives by the
// candle are the same row by construction. The standing recompute is not
// optional here: granted ground moves a neighbour's tier exactly as a clearing's
// does, and skipping it would re-open the replay gate's finding 4 through the
// side door.
//
// ── THE ACT, AND THE ONE SEAM THIS TOOL CANNOT CLOSE ────────────────────────
//
// A ruling is a deed the town did, so it takes a row in `acts` — where the
// notary exports it to public git and anyone can read that a mind ruled, who,
// and why. But `acts` INSERT belongs to `office_api` (002_grants.sql) and this
// tool holds `clearing_job`; the roles falsifier exists precisely to red when a
// fourth writer appears, so granting `clearing_job` an acts INSERT is a law-tier
// change and NOT this lane's to make unilaterally. It is teed instead.
//
// So the run is ORDERED, not atomic: the ruling transaction commits first, then
// the act is written on a second connection. The ordering is chosen so that the
// failure mode is recoverable — `acts` is append-only, so an act for a ruling
// that then rolled back could never be taken out again, while a ruling whose act
// did not land is fully recorded in `claims.ruling` and `windows.receipts` and
// can have its act written afterwards. `--journal-only` is that repair, and it
// refuses to write a second act for a ruling that already has one.
//
// ── THE SECOND DOOR, AND WHY IT NAMES RATHER THAN REFUSES (postmark#2594) ───
//
// Keemin ruled on 2026-09-08: "a claim that would lock while the mark it
// materializes has no file on main at the locking crossing is REFUSED at the
// clearing job's lock step" — and WITHDREW that lock-time refusal the same
// evening, when the reviewer measured the settlement's push landing minutes
// AFTER the candle clears (`canon-register.mjs`'s header carries the table).
// Nothing at the candle reads canon now. What survives of the ruling here is
// the door: this file is the OTHER lawful writer of `marks` — it writes
// `status = 'locked'` and calls the same `materializeClaims` — so a mind
// granting a contest can materialize a mark canon does not carry, and no
// candle step ever saw or sees it.
//
// A GUARD HERE WOULD BE THE WRONG SHAPE, and that is a judgement the lane made
// and the conductor took (2026-09-08): a mind ruling on a contest is a
// deliberate act by somebody who can read canon for themselves, and the ruling
// covers the candle. What was missing is not a refusal — it is the FACT. So this
// prints one line when the granted claim's slug has no canon file, and the mind
// rules with it in front of them.
//
// AND IT NAMES ITS OWN ABSENCE. Without `--world-repo` the line says the check
// did not run, rather than printing nothing: "asked and found nothing" and
// "never asked" must not look alike, which is the whole of what #2594 is about.
// The nightly read (`falsifier-canon-locks.mjs`) catches whatever comes through
// this door regardless, because it walks standing marks and does not care which
// door they arrived by.
//
// ── USAGE ───────────────────────────────────────────────────────────────────
//
//   node world2/tools/review-rule.mjs --claim <uuid> --rule grant|refuse|hold \
//        --by <handle> --because "<one sentence>" [--world-repo <checkout>] \
//        [--dry-run] [--json]
//   node world2/tools/review-rule.mjs --claim <uuid> --journal-only
//
//   env: WORLD2_CLEARING_URL = postgres://clearing_job:…@localhost/world2_dev
//        WORLD2_OFFICE_URL   = postgres://office_api:…@localhost/world2_dev
//
//   `grant`  the named claim locks and materializes; every other claim in its
//            contest is refused, naming the ruling.
//   `refuse` the named claim and its whole contest are refused. Nothing stands.
//   `hold`   nothing transitions. The ruling is recorded on every claim in the
//            contest so the record shows a mind looked and deferred — a held
//            claim with no ruling and a held claim a mind has deliberately left
//            held are different facts, and the docket should be able to say
//            which.

import { realpathSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { materializeClaims, recomputeStanding, slugOf, ownerHouseholdFor, liveHouseOfVia } from "./materialize.mjs";
import { fractionalCrossing } from "./live-reads.mjs";
// The #2594 predicate, for NAMING only — this door is deliberately not gated by
// it. See § THE SECOND DOOR below.
import { canonRegisterAt } from "./canon-register.mjs";
// The escrow PRESENCE rule — a real blocker here, unlike the canon note. See
// § THE SECOND DOOR.
import { escrowAbsentAmong, escrowPresenceAt } from "./escrow-presence.mjs";
import { computeStanding } from "./standing.mjs";

const arg = (n) => { const i = process.argv.indexOf(n); return i === -1 ? null : process.argv[i + 1]; };
const has = (n) => process.argv.includes(n);

export const RULINGS = Object.freeze(["grant", "refuse", "hold"]);
export const REVIEW_CLASS = "review";     // the acts class — see § THE ACT
export const REVIEW_ACTION = "rule";      // "a mind RULES" (census D2's own verb)

// The same operator `marks`' exclusion constraint and the clearing's step 4/5
// use, so the ruling, the candle and the constraint can never disagree about
// what "overlaps" means.
const OVERLAP = "a.bbox && b.bbox";

/**
 * THE CONTEST — every claim the ruling is about.
 *
 * Two ways in, unioned, because the clearing records a contest twice over and a
 * ruling that read only one of them would silently rule on half of it:
 *
 *   · GEOMETRY, which is how step 5 decides one: held_review claims in the same
 *     window whose bbox overlaps this one's. This is the live rule today.
 *   · THE REFUSAL TEXT, which is how step 5 WRITES one down
 *     ("counterclaim: collides with <id>"). If a future rule ever holds two
 *     claims for a reason that is not geometry, the pairing it recorded is still
 *     found here rather than dropped.
 *
 * The named claim is always in its own contest.
 */
export async function contestOf(q, claim) {
  const { rows } = await q(
    `SELECT c.* FROM claims c
      WHERE c.window_id = $1 AND c.status = 'held_review' AND c.id <> $2
        AND ( c.refusal_check LIKE '%' || $2::text || '%'
              OR EXISTS (SELECT 1 FROM (SELECT bbox FROM claims WHERE id = c.id) a,
                                       (SELECT bbox FROM claims WHERE id = $2) b
                          WHERE ${OVERLAP}) )
      ORDER BY submitted_at, id`, [claim.window_id, claim.id]);
  return [claim, ...rows];
}

/**
 * HAS THE WORLD MOVED UNDER THIS RULING? Steps 1 and 4 of the clearing, re-asked
 * at ruling time. Returns the reasons the run must refuse, and the standing mark
 * the winner amends when there is one.
 */
export async function reCheckGrant(q, winner, { townSha = null } = {}) {
  const blockers = [];
  let amended = null;
  const slug = slugOf(winner);
  if (!slug) return { blockers: ["the granted claim names no mark (no slug, no geometry.slug) — there is nothing for a grant to materialize"], amended };

  const { rows: standing } = await q(
    "SELECT id::text, slug FROM marks WHERE slug = $1 AND status = 'standing' AND id <> $2", [slug, winner.id]);
  if (standing.length) {
    if (winner.supersedes && String(winner.supersedes) === standing[0].id) amended = standing[0];
    else blockers.push(`a standing mark already carries "${slug}" (${standing[0].id.slice(0, 8)}) and this claim does not supersede it — ` +
      `the ground was taken while the claim was held, and that is a fact the mind ruled without`);
  }
  if (winner.class === "parcel" && winner.bbox) {
    const { rows } = await q(
      `SELECT b.slug FROM marks b, (SELECT bbox FROM claims WHERE id = $1) a
        WHERE b.kind = 'parcel' AND b.status = 'standing' AND ${OVERLAP}
          AND ($2::uuid IS NULL OR b.id <> $2::uuid) LIMIT 1`, [winner.id, amended?.id ?? null]);
    if (rows.length) blockers.push(`this parcel now overlaps standing parcel "${rows[0].slug}" — ` +
      `the ground was taken while the claim was held; contesting a STANDING mark is a different question from the one that was held`);
  }
  // ── THE ESCROW PRESENCE RULE, RE-RUN AT RULING TIME (postmark#2594) ───────
  //
  // This door LOCKS and MATERIALIZES, so the rule the candle's step 5.5 carries
  // has to hold here too, or the register grows commons marks with nothing
  // behind them through the one door nobody is watching. The conductor ruled it
  // in on 2026-09-08: the review door gets the predicate, not only the canon
  // naming line above.
  //
  // A BLOCKER, NOT A REFUSAL OF THE CLAIM — which is this file's own established
  // shape for a fact that changed while the claim was held: "a failure REFUSES
  // THE RUN rather than refusing the claim. A mind ruled on facts that have
  // changed; that wants the mind again, not this tool's guess." A mind that
  // still wants to grant it can have the stake put on first.
  //
  // The class is computed prospectively, exactly as the candle does it, so the
  // two doors cannot disagree about what `commons` means: `computeStanding` over
  // the standing rows plus this candidate, in the shape `materializeClaims` is
  // about to insert. And an escrow projection that cannot answer blocks NOTHING —
  // `escrowAbsentAmong` returns `unchecked` for that, never a refusal, because a
  // store that cannot answer and a town where nobody staked are different facts.
  if (townSha) {
    const { rows: standingRows } = await q(
      `SELECT id::text, slug, kind, owner, household, geometry, parent::text, data
         FROM marks WHERE status = 'standing'`);
    const candidate = {
      id: String(winner.id), slug, kind: winner.class, owner: winner.claimant,
      household: await ownerHouseholdFor(q, winner.claimant),
      geometry: winner.geometry, parent: winner.parent, data: winner.data,
    };
    const tiers = computeStanding([...standingRows, candidate], { houseOf: await liveHouseOfVia(q) });
    const escrowByMark = await escrowPresenceAt(q, { townSha });
    const verdict = escrowAbsentAmong([{ id: winner.id, slug }], { tiers, escrowByMark, townSha });
    if (verdict.refused.length)
      blockers.push(`"${slug}" would stand as a COMMONS mark with nothing staked on it at town ${String(townSha).slice(0, 8)} — ` +
        `the town's own sweep refuses this ("commons needs escrow > 0") and the candle refuses it at the lock step; ` +
        `a mind granting it here would put the one mark in the register that neither other door would allow`);
    if (verdict.unchecked.length)
      console.log(`  ⚑ escrow NOT CHECKED for ${slug} — escrow_projection cannot answer at town ${String(townSha).slice(0, 8)} (migration 014); this ruling does not know whether the mark is backed`);
  } else {
    console.log(`  ⚑ escrow NOT CHECKED for ${slug} — this window pinned no town read, so the presence rule could not be asked`);
  }

  return { blockers, amended };
}

// ── the run ──────────────────────────────────────────────────────────────────

async function main() {
  const claimId = arg("--claim");
  if (!claimId) { usage("which claim?"); }
  if (!process.env.WORLD2_CLEARING_URL) { console.error("WORLD2_CLEARING_URL missing (role clearing_job)"); process.exit(2); }

  const { default: pg } = await import("pg");

  if (has("--journal-only")) return journalOnly(pg, claimId);

  const kind = arg("--rule");
  const by = arg("--by");
  const because = arg("--because");
  const worldRepo = arg("--world-repo");   // § THE SECOND DOOR — naming, not gating
  if (!RULINGS.includes(kind)) usage(`--rule must be one of ${RULINGS.join(" | ")}`);
  // A RECEIPT WITH NO NAME IS NOT A RECEIPT. `held_review` means "a mind rules",
  // and a ruling that cannot say whose mind it was is exactly the state-with-no-
  // receipt class this store was built to end.
  if (!by) usage("--by <handle> is required: a ruling that cannot name who ruled is a state with no receipt");
  if (!because) usage("--because \"<one sentence>\" is required: Decision 2 makes stake-weight advisory, so the reasoning is the whole record of why one claim won");

  const client = new pg.Client({ connectionString: process.env.WORLD2_CLEARING_URL });
  await client.connect();
  const q = (text, args = []) => client.query(text, args);

  let out = null;
  try {
    await q("BEGIN");

    const { rows: [claim] } = await q("SELECT * FROM claims WHERE id = $1 FOR UPDATE", [claimId]);
    if (!claim) throw new Error(`no claim ${claimId}`);
    if (claim.status !== "held_review") {
      throw new Error(`claim ${claimId} is '${claim.status}', not 'held_review' — this tool resolves a contest a candle held ` +
        `for REVIEW, and nothing else transitions a claim`);
    }

    // The window the RULING happens in, which is not the window the contest
    // happened in. The held window is closed and its acts may already be in the
    // notary's frozen archive; a mark inserted against it would date a deed to a
    // window that had finished. This is the drafts lane's ruling applied one lane
    // over: "putting-forward dating accepted (also avoids inserting into
    // notary-frozen windows)".
    const { rows: [open] } = await q(
      "SELECT id, receipts FROM windows WHERE status = 'open' ORDER BY id DESC LIMIT 1 FOR UPDATE");
    if (!open) throw new Error("no window is open — the candle never leaves the town without one, so this store is in a state a ruling must not paper over");

    const contest = await contestOf(q, claim);
    const at = new Date().toISOString();
    const ruling = { by, kind, because, at, contest: contest.map((c) => String(c.id)) };

    let amended = null;
    if (kind === "grant") {
      // THE TOWN SHA IS THE LATEST PINNED ONE, NOT THE OPEN WINDOW'S.
      // `windows.town_sha` is written by the clearing AT CLOSE, so the open
      // window this ruling lands in has none — reading `open.town_sha` would
      // hand `reCheckGrant` a null on every run and the presence rule would
      // never fire. That is the value-with-no-reader defect, and I wrote it
      // before checking which write fills the column. The latest CLOSED window's
      // pin is also the right answer on its own terms: this file's rule for a
      // re-check is "the world as it now stands".
      const { rows: [pinned] } = await q(
        "SELECT town_sha FROM windows WHERE town_sha IS NOT NULL ORDER BY id DESC LIMIT 1");
      const re = await reCheckGrant(q, claim, { townSha: pinned?.town_sha ?? null });
      if (re.blockers.length) {
        throw new Error(`the world moved while this claim was held, so the ruling is REFUSED rather than applied:\n  - ` +
          re.blockers.join("\n  - ") + `\nNothing was written. Re-decide the contest against the world as it now stands.`);
      }
      amended = re.amended;
    }

    // The transitions. `hold` writes the receipt and moves nothing — a held claim
    // a mind has deliberately left held is a different fact from one nobody has
    // looked at, and only the receipt can tell them apart.
    const outcomes = [];
    for (const c of contest) {
      const isWinner = String(c.id) === String(claim.id);
      const next = kind === "hold" ? "held_review"
        : kind === "refuse" ? "refused"
        : isWinner ? "locked" : "refused";
      const check = next !== "refused" ? null
        : kind === "refuse"
          ? `review-ruling: ${by} refused this contest — ${because}`
          : `review-ruling: ${by} granted ${slugOf(claim) ?? String(claim.id).slice(0, 8)} — ${because}`;
      await q("UPDATE claims SET status = $2, refusal_check = $3, decided_at = now(), ruling = $4 WHERE id = $1",
        [c.id, next, check, JSON.stringify({ ...ruling, outcome: next, winner: isWinner && kind === "grant" })]);
      outcomes.push({ claim: String(c.id), slug: slugOf(c), was: c.status, now: next });
    }

    let materialized = 0;
    let standingMoved = { moved: [], standing: [], notes: [] };
    let canonNote = null;
    if (kind === "grant") {
      // § THE SECOND DOOR — the fact, printed. Never a refusal, and never silent.
      const grantedSlug = slugOf(claim);
      if (!grantedSlug) {
        canonNote = null;                       // a claim naming no mark makes none
      } else if (!worldRepo) {
        canonNote = `canon NOT CHECKED for ${grantedSlug} — no --world-repo was given, so this ruling does not know whether the world carries the mark it is about to stand (postmark#2594)`;
      } else {
        try {
          const register = await canonRegisterAt({ backend: "git", worldRepo });
          canonNote = register.slugs.has(grantedSlug) ? null
            : `canon carries NO FILE for ${grantedSlug} at ${register.sha.slice(0, 8)} — this ruling stands a mark the world does not hold (postmark#2594); the nightly read will list it at 03:20 until the world carries it or it is retired, and a mind may not be wrong to grant it anyway`;
        } catch (err) {
          canonNote = `canon could not be read (${err.message}) — this ruling does not know whether the world carries ${grantedSlug}`;
        }
      }
      if (canonNote) console.log(`  ⚑ ${canonNote}`);

      materialized = await materializeClaims(q, {
        claims: [claim],
        amends: amended ? new Map([[String(claim.id), amended]]) : new Map(),
        windowId: open.id, label: `the review ruling on ${String(claim.id).slice(0, 8)}`,
      });
      standingMoved = await recomputeStanding(q);
    }

    // The window's own account. Appended, never replaced — and `clearing-job.mjs`
    // carries this key forward when it closes the window, because that UPDATE
    // replaces `receipts` whole and would otherwise erase it.
    const existing = Array.isArray(open.receipts?.review_rulings) ? open.receipts.review_rulings : [];
    await q(
      `UPDATE windows SET receipts = coalesce(receipts, '{}'::jsonb) || jsonb_build_object('review_rulings', $2::jsonb) WHERE id = $1`,
      [open.id, JSON.stringify([...existing, {
        ...ruling, held_window: claim.window_id, outcomes,
        // The canon fact rides on the RULING, not only on the console. The
        // conductor asked for one printed line; a printed line is gone the
        // moment the terminal scrolls, and this receipt is the durable record of
        // what a mind ruled and what it knew when it ruled. Same key on both.
        ...(canonNote ? { canon_note: canonNote } : {}),
        ...(kind === "grant" ? { materialized, standing_moved: standingMoved.moved.length } : {}),
      }])]);

    out = {
      claim: String(claim.id), slug: slugOf(claim), rule: kind, by, because, at,
      held_window: claim.window_id, ruled_in_window: open.id,
      contest: contest.length, outcomes, materialized, canon_note: canonNote,
      standing: { recomputed: standingMoved.standing.length, moved: standingMoved.moved.length, moves: standingMoved.moved.slice(0, 10) },
      notes: standingMoved.notes,
      act: null,
    };

    if (has("--dry-run")) {
      await q("ROLLBACK");
      out.dry_run = true;
    } else {
      await q("COMMIT");
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    await client.end();
    console.error(`RULING REFUSED (${claimId}): ${err.message}\n  — nothing moved (one transaction, gold §1)`);
    process.exit(1);
  }
  await client.end();

  if (!out.dry_run) out.act = await writeAct(pg, out);

  report(out);
  // A ruling whose act did not land is a ruling that happened and a log that
  // does not say so. It is recoverable and the repair is printed, but it is not
  // a green run.
  process.exit(out.act?.written === false ? 1 : 0);
}

/**
 * THE ACT — the ruling as a public deed, on the second connection.
 *
 * `class: 'review'` is a class no 1.0 pen writes, and that is a first for this
 * table: every other row in `acts` is a 1.0 act mirrored into 2.0, while this
 * one is BORN in `acts`. `falsifier-acts-lane-closure.mjs`'s two censuses are
 * both anchored on the sqlite journal, so neither can see this class — the
 * closure that covers it is `falsifier-review-closure.mjs`, named here so the
 * next reader of the census finds the answer where they look for it.
 *
 * `at_anchor`/`at_dx`/`at_dy` are NULL and that is deliberate: the witnessed
 * line is "an anchor and an offset", and a ruling was not made anywhere in the
 * world. Writing a coordinate would forge a standpoint nobody stood at — the
 * same refusal the seed makes for legacy acts.
 *
 * `household` is NULL for the same shape of reason: a mind rules as the REVIEW
 * lane, not as a household, and the stake math this column exists for has
 * nothing to say about a ruling.
 *
 * `payload.at` IS THE RULING'S IDENTITY, and it is here because the closure
 * falsifier's first live run needed it. A contest can be ruled more than once —
 * `hold` today, `refuse` next week — and both are real deeds that belong in an
 * append-only log. Without the ruling instant on the row, "the act for this
 * claim" is not a question with one answer, and the check either forbids a
 * lawful second ruling or stops noticing a missing one. Same shape as
 * `falsifier-acts-claims-closure.mjs`'s `(journal_seq, slug)` fix: the pairing
 * key has to be an identity.
 */
async function writeAct(pg, out) {
  if (!process.env.WORLD2_OFFICE_URL) {
    return { written: false, why: "WORLD2_OFFICE_URL is not set (role office_api), so the ruling has no act",
             repair: `WORLD2_OFFICE_URL=… node world2/tools/review-rule.mjs --claim ${out.claim} --journal-only` };
  }
  const c = new pg.Client({ connectionString: process.env.WORLD2_OFFICE_URL });
  try {
    await c.connect();
    const { rows: [r] } = await c.query(
      `INSERT INTO acts (at, crossing, actor, action, object, at_anchor, at_dx, at_dy,
                         witnesses, class, payload, effect, household, journal_seq)
       VALUES ($1,$2,$3,$4,$5,NULL,NULL,NULL,NULL,$6,$7,$8,NULL,NULL) RETURNING id::text`,
      [new Date().toISOString(), fractionalCrossing(), out.by, REVIEW_ACTION,
       out.slug ?? out.claim, REVIEW_CLASS,
       JSON.stringify({ claim: out.claim, rule: out.rule, because: out.because, at: out.at,
                        held_window: out.held_window, ruled_in_window: out.ruled_in_window,
                        contest: out.outcomes }),
       `a mind ruled a contest the candle held for REVIEW (census D2): ${out.rule}`]);
    return { written: true, act_id: r.id };
  } catch (e) {
    return { written: false, why: String(e?.message ?? e).slice(0, 300),
             repair: `node world2/tools/review-rule.mjs --claim ${out.claim} --journal-only` };
  } finally { await c.end().catch(() => {}); }
}

/** The repair path: write the act for a ruling that already committed. */
async function journalOnly(pg, claimId) {
  const cj = new pg.Client({ connectionString: process.env.WORLD2_CLEARING_URL });
  await cj.connect();
  const { rows: [claim] } = await cj.query("SELECT * FROM claims WHERE id = $1", [claimId]);
  await cj.end();
  if (!claim) { console.error(`no claim ${claimId}`); process.exit(2); }
  if (!claim.ruling) { console.error(`claim ${claimId} carries no ruling — there is nothing to journal`); process.exit(2); }

  if (!process.env.WORLD2_OFFICE_URL) { console.error("WORLD2_OFFICE_URL missing (role office_api)"); process.exit(2); }
  const oa = new pg.Client({ connectionString: process.env.WORLD2_OFFICE_URL });
  await oa.connect();
  const r = claim.ruling;
  // `acts` is append-only for every pen, so a duplicate could never be removed.
  // Keyed on THIS ruling's instant, not on the claim: a contest may lawfully be
  // ruled twice (a `hold` and then a decision), and keying on the claim alone
  // would refuse to journal the second one.
  const { rows: existing } = await oa.query(
    "SELECT id::text FROM acts WHERE action = $1 AND class = $2 AND payload->>'claim' = $3 AND payload->>'at' = $4",
    [REVIEW_ACTION, REVIEW_CLASS, String(claim.id), r.at ?? null]);
  if (existing.length) {
    await oa.end();
    console.log(`already journalled: acts ${existing.map((r2) => r2.id).join(", ")} — nothing written (acts is append-only; a second row could never be taken back)`);
    process.exit(0);
  }
  await oa.end();
  const act = await writeAct(pg, { claim: String(claim.id), slug: slugOf(claim), rule: r.kind, by: r.by,
    because: r.because, at: r.at, held_window: claim.window_id, ruled_in_window: null, outcomes: r.contest ?? [] });
  console.log(act.written ? `journalled: acts ${act.act_id}` : `COULD NOT JOURNAL: ${act.why}`);
  process.exit(act.written ? 0 : 1);
}

function usage(defect) {
  console.error(`review-rule.mjs: ${defect}\n\n` +
    `  --claim <uuid> --rule ${RULINGS.join("|")} --by <handle> --because "<one sentence>" [--dry-run] [--json]\n` +
    `  --claim <uuid> --journal-only        write the act for a ruling that already committed\n`);
  process.exit(2);
}

function report(out) {
  if (has("--json")) { console.log(JSON.stringify(out, null, 2)); return; }
  const head = out.dry_run ? "DRY RUN" : "RULED";
  console.log(`${head} ${out.rule} · claim ${out.claim.slice(0, 8)}${out.slug ? ` (${out.slug})` : ""} · by ${out.by}`);
  console.log(`  held in window ${out.held_window}, ruled in window ${out.ruled_in_window} · contest of ${out.contest}`);
  for (const o of out.outcomes) console.log(`    ${o.claim.slice(0, 8)} ${o.slug ?? "—"}: ${o.was} → ${o.now}`);
  if (out.materialized) console.log(`  materialized ${out.materialized} mark(s); standing recomputed over ${out.standing.recomputed}, ${out.standing.moved} moved` +
    (out.standing.moves.length ? ` (${out.standing.moves.map((m) => `${m.slug} ${m.from}→${m.to}`).join(", ")})` : ""));
  for (const n of out.notes) console.log(`  ⚑ standing: ${n}`);
  if (out.dry_run) console.log("  (rolled back — nothing moved)");
  else if (out.act?.written) console.log(`  act ${out.act.act_id} · class ${REVIEW_CLASS} action ${REVIEW_ACTION}`);
  else if (out.act) console.log(`  ⚠ THE RULING STANDS BUT ITS ACT DID NOT LAND: ${out.act.why}\n    repair: ${out.act.repair}`);
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
