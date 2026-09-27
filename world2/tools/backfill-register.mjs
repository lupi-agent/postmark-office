#!/usr/bin/env node
// ── backfill-register.mjs — the store learns what 1.0 already knows (DEC-18) ──
//
// RULED 2026-09-05 (founder: "I agree with 2", then "backfill writes are good
// too"): the live store is canonical, F1's parity claim re-scopes to the eras
// after the seed, and the marks 1.0's register carries and the store does not
// become a backfill lane, ONE CLASS PER PR, each class diffed before any write.
//
// WHY A TOOL AND NOT A SCRIPT. A script is run once by whoever wrote it and
// re-run six weeks later by someone who does not know what it assumed. This
// takes a `--class`, prints the exact rows under `--dry-run`, and refuses under
// `--write` unless every one of its guards is satisfied by a flag someone typed
// on purpose. The dry run and the write derive their rows from THE SAME
// function; there is no second path that could disagree with the rehearsal.
//
// EVERY WRITE IS AN ADMISSION. The store never learns a fact without saying
// where it came from: each row goes in through `materializeClaims` — the SAME
// function the clearing job and the review lane use, never a fourth way of
// turning a claim into a mark — behind a `locked` claim carrying
// `data.locked_by` and `data.founder_commit` / `data._source`. That is DEC-17's
// admission path, reused rather than re-implemented, and it means a later reader
// of any backfilled row can name the commit on world main that is its authority.
//
// WHAT IT REFUSES, BY NAME AND WITHOUT ARGUMENT:
//   · whatever `REFUSED_BY_NAME` names — refused as a name, not as a rule with
//     an exception, so no `--class` and no future filter can reach it by
//     accident. EMPTY TODAY. It held `wright/the-lit-name` for the founder's
//     sitting (escrow-bearing) until RULED 2026-09-24 (Keemin: "meant keep it
//     in!") — the lit-name comes into the store. Measured before the set was
//     emptied: an ingest writes the mark's claim (stake 0) and its `marks` row
//     and nothing else; escrow is `escrow_projection`, keyed by the text
//     `<by>/<slug>` with no foreign key to `marks`, written by stamp-ingest from
//     the town ledger, and it already carries positions under the new name. So
//     admitting it needed nothing beyond the set. The mechanism stays: a future
//     hold is one name added here, and every tool that imports the set honours it.
//   · anything whose claim in the store is a `draft` — a private draft is the
//     resident's, and publishing it from here would put a mark in the register
//     that its author never put forward. These are reported and skipped; the
//     five at S58 are a ruling, not a backfill.
//     RULED 2026-09-08 (founder, at the G1 sitting: "agree with your rec"): A
//     PRIVATE DRAFT NEVER BLOCKS THE PUBLISHED BODY. The world's published mark
//     becomes the standing row, locked at its source commit; the household's
//     draft stays a draft — a revision on top, judged at the next window as any
//     draft is. The skip above is the default; `--published-body-over-draft`
//     is the ruling typed on purpose, and the receipt names every row it
//     touched beside a draft.
//   · a database whose name contains neither `lab` nor `scratch`, unless `--prod`
//     is ALSO given. Two flags, deliberately. NOTE (measured 2026-09-05): the box
//     has no separate lab store — `/srv/world2-lab/lab.env` and
//     `/etc/postmark-office.env` name the SAME database, `world2_dev`. So on that
//     box the only safe rehearsal target is a scratch database, and the name
//     `world2_dev` trips this guard, which is the correct outcome.
//
// Nothing here removes a row, retires a mark, or edits `acts`. A backfill adds
// what 1.0 already published; anything subtractive is a ruling.

import pg from "pg";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { deriveSeed, compareMarks } from "./seed-import.mjs";
import { materializeClaims, recomputeStanding } from "./materialize.mjs";
import { historyFor, isSweepCommit, parseFinding } from "./parity-causes.mjs";
// The gate's own scope, filter and strip — imported, never restated. See
// § THE BACKFILL IS DRIVEN BY THE GATE'S OWN FINDINGS below for what it cost
// to learn that a second copy of this comparison is not the same comparison.
import { SUBSTANCE_COLUMNS, standingOnly, stripSlug, checkoutAt } from "./replay-ingest.mjs";
import { uuid5 } from "./seed-import.mjs";

/** HELD by the founder's word. Not a class, not a filter — a name. Empty since 2026-09-24 (see the header). */
export const REFUSED_BY_NAME = new Set([]);

const NL = String.fromCharCode(10);

// ── AN AMEND IS NOT REVERSIBLE, AND THE TOOL NOW SAYS SO BEFORE IT WRITES ────
//
// The founder's pre-authorization rested on the conductor's description
// "additive rows, reversible by id list". Measured (2026-09-05, on a scratch
// clone): TRUE of the ADD classes — the mark row is new, `marks.id` is the
// locking claim's id, and it can be deleted back out. FALSE of the AMEND
// classes — `materializeClaims` REWRITES the standing row in place keeping its
// id, so the prior body and geometry exist nowhere in the store and the only
// recovery is a dump restore with the office stopped.
//
// Until now nothing said so at the point of action. An add class could never
// emit an amend (a non-MISSING slug is given an `-amend-` cause by construction,
// so the class filter drops it), which made the tool structurally safe against
// the wrong thing: the danger was never a class quietly containing amends, it
// was someone TYPING an amend class and the tool running it with the same three
// flags as an add. The hold was a discipline, not a guard. This makes it a guard.
//
// The check is on THE PLAN, not on the class name — a class list would go stale
// the first time a cause is added, and a plan that carries an amend is the fact
// that matters however it got there.
export const HELD_AMEND_CLASSES = ["sweep-amend-unmirrored", "hand-amend-on-main"];
export const AMEND_FLAG = "amends-are-not-reversible";

/**
 * Why a `--write` may not proceed, or null. Pure, so the refusal can be proved
 * without a database, a repo, or a plan that took four minutes to derive.
 *
 * `--recompute-standing` sits behind the same flag and for the same reason: it
 * adds no row, it runs an UPDATE of `data.tier` across every standing mark whose
 * tier moved — including rows this backfill never touched — and the prior tier is
 * nowhere in the store afterwards. By the same test it is an in-place rewrite.
 * Holding it costs nothing: the clearing job recomputes tier at every window
 * close, so `stale-tier` closes itself at the next candle.
 */
export function refusalFor({ amendCount = 0, recompute = false, accepted = false }) {
  if (accepted) return null;
  if (amendCount > 0) {
    return `--write refuses: this plan carries ${amendCount} AMEND(s), and an amend is NOT reversible — ` +
      `\`materializeClaims\` rewrites the standing row in place keeping its id, so the prior body and ` +
      `geometry exist nowhere in the store and the only way back is a dump restore with the office ` +
      `stopped. The founder's authorization was given for "additive rows, reversible by id list", which ` +
      `is true of the ADD classes and false of these. HELD classes: ${HELD_AMEND_CLASSES.join(", ")}. ` +
      `Pass --${AMEND_FLAG} as WELL if the sitting has ruled otherwise.`;
  }
  if (recompute) {
    return `--write refuses --recompute-standing: it writes no new row, it REWRITES \`data.tier\` across ` +
      `every standing mark whose tier moved — including rows this backfill never touched — and the prior ` +
      `tier is nowhere in the store afterwards. Same test, same hold. Nothing is lost by waiting: the ` +
      `clearing job recomputes tier at every window close, so \`stale-tier\` closes itself at the next ` +
      `candle. Pass --${AMEND_FLAG} as WELL if the sitting has ruled otherwise.`;
  }
  return null;
}

// ── A ZERO THAT MEANS "NONE" AND A ZERO THAT MEANS "YOU MAY NOT LOOK" ────────
//
// THE BUG THIS EXISTS FOR, and it is the worst one this lane produced because
// nothing in the code was wrong. `claims` has row-level security on since 007:
//
//   CREATE POLICY claims_read ON claims FOR SELECT
//     USING (status <> 'draft' OR household = current_setting('app.household', true))
//
// `draftSlugs` is built from a plain `SELECT slug, status FROM claims`. Under
// `office_api` — which never sets `app.household` — that SELECT returns NO DRAFT
// ROWS AT ALL, so the set is empty, so the skip that holds five residents' private
// drafts can never fire, and `sweep-published-unmirrored` plans 32 adds instead of
// 27 with no SKIPPED block to notice. The five would have been published on prod.
//
// My rehearsal saw them only because the scratch clone was queried as `postgres`,
// the table owner, and 007 deliberately does NOT `FORCE ROW LEVEL SECURITY` — so
// the owner bypasses the policy. THE CLONE WAS FAITHFUL AND THE CONNECTION WAS
// NOT. A rehearsal has to reproduce who is looking, not only what is there.
//
// So the tool now asks, before it plans anything, whether THIS connection can see
// a draft — and refuses when it cannot rather than reporting an empty set. The
// escape hatch is `--drafts-held-by-name <file>`: a name survives a policy, a
// status does not, so an operator who cannot see the drafts may still name them.
export const DRAFTS_FLAG = "drafts-held-by-name";
/** The 2026-09-08 ruling, typed on purpose: the published body is written even where the store holds a private draft under the slug. */
export const PUBLISH_OVER_DRAFT_FLAG = "published-body-over-draft";

/**
 * The by-name hold file: one slug per line, blank lines and `#` comments ignored
 * so the file can say WHO these people are rather than being a bare list.
 *
 * Exported and pure because it is the escape hatch's whole surface: if this
 * mis-parses, an operator who did everything right still publishes a resident's
 * private draft, and the mistake looks like the file being empty.
 */
export const heldSlugsFrom = (text) =>
  String(text).split(/\r?\n/).map((l) => l.replace(/#.*$/, "").trim()).filter(Boolean);

/**
 * WHAT THIS CONNECTION CAN SEE, and what would be there if nothing were hiding.
 *
 * THE CONDITION IS A COUNT, NOT A ROLE (reviewer, 2026-09-05). The first version
 * of this asked "is this connection privileged", which gives the right answer
 * today and is the wrong sentence: it describes the connection instead of the
 * thing that matters, which is whether the draft count this connection sees is
 * the true one. The two come apart the moment a policy changes — `FORCE ROW
 * LEVEL SECURITY` takes the owner's exemption away without touching any grant —
 * and they would come apart again for any future policy nobody here anticipated.
 *
 * So the structural facts below are the EXPLANATION, and `visibleDrafts` is the
 * measurement. Both are printed, in both arms, so a dry run's receipt and a
 * write's receipt can be held against each other and seen to be the same eyes.
 */
export async function visibilityProbe(client) {
  const { rows } = await client.query(`
    SELECT current_user::text                                   AS whoami,
           current_database()::text                             AS db,
           (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypassrls,
           c.relrowsecurity                                     AS rls_enabled,
           c.relforcerowsecurity                                AS rls_forced,
           pg_get_userbyid(c.relowner)::text                    AS table_owner,
           (SELECT count(*)::int FROM claims WHERE status = 'draft') AS visible_drafts
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relname = 'claims' AND n.nspname = 'public'`);
  const r = rows[0] ?? {};
  return {
    whoami: r.whoami ?? null,
    db: r.db ?? null,
    bypassrls: Boolean(r.bypassrls),
    rlsEnabled: Boolean(r.rls_enabled),
    rlsForced: Boolean(r.rls_forced),
    tableOwner: r.table_owner ?? null,
    visibleDrafts: r.visible_drafts ?? 0,
  };
}

/**
 * Is the draft count this connection sees the TRUE one?
 *
 * `claims_read` filters `status = 'draft'` for every session the policy applies
 * to, so "the policy does not apply to me" and "my count is the whole count" are
 * the same statement — but only the second one is what the caller needs, and only
 * the second one stays true if the policy is rewritten. Stated in that order.
 *
 * The policy does not apply when RLS is off, when the role bypasses it, or when
 * the role owns the table AND the policy is not FORCEd. 007 says why it is not
 * FORCEd; that exemption is the only reason the first rehearsal saw anything, so
 * it is written down rather than relied on silently.
 */
export const seesAllDrafts = (v) =>
  !v.rlsEnabled || v.bypassrls || (v.whoami === v.tableOwner && !v.rlsForced);

/** Kept as the older name for one release; `seesAllDrafts` is what it means. */
export const canSeeDrafts = seesAllDrafts;

/** The one line both arms print, so two receipts can be checked against each other. */
export const visibilityLine = (v, held) =>
  `connection ${v.whoami}@${v.db} · claims RLS ${v.rlsEnabled ? "ON" : "off"}` +
  `${v.rlsForced ? " (FORCED)" : ""} · bypassrls ${v.bypassrls} · table owner ${v.tableOwner}` +
  ` · drafts visible to this connection: ${v.visibleDrafts}` +
  ` (${seesAllDrafts(v) ? "the true count — no policy filters this connection"
    : "A FILTERED SUBSET — the true count is unknown from here"})` +
  `${held ? ` · ${held.size} slug(s) held BY NAME` : ""}`;

export function visibilityRefusal(v, { heldByName = null } = {}) {
  if (seesAllDrafts(v)) return null;
  if (heldByName) return null;                 // a name is sufficient on its own
  return `refusing to plan: this connection is \`${v.whoami}\` and it can see ${v.visibleDrafts} draft ` +
    `claim(s), which is A FILTERED SUBSET, not the true count. Row-level security is ON for \`claims\`` +
    `${v.rlsForced ? " and FORCEd" : ""}, ${v.whoami} neither bypasses it nor owns the table ` +
    `(owner: ${v.tableOwner}), and policy \`claims_read\` hides every row whose status is 'draft' from a ` +
    `session that has not set \`app.household\`. So the hold on residents' private drafts CANNOT FIRE, ` +
    `and it would report SKIPPED 0 while doing it. A zero meaning "there are none" and a zero meaning ` +
    `"you are not permitted to look" must not be spelled the same way, so this refuses rather than ` +
    `planning against a subset. Either connect as a role whose count is the true one (\`world2_owner\` ` +
    `owns these tables) or pass --${DRAFTS_FLAG} <file>, one slug per line — a name survives a policy.`;
}

// ── AND WHETHER THIS CONNECTION MAY WRITE AT ALL ────────────────────────────
//
// Measured from `002_grants.sql`, and the answer is that NEITHER of the two roles
// an operator would reach for can do this job:
//
//   office_api    SELECT all · INSERT acts · INSERT,UPDATE claims   — NO marks write
//   clearing_job  SELECT all · UPDATE claims · INSERT,UPDATE marks  — NO claims INSERT
//
// A backfill inserts claims AND writes marks, so it needs both halves: the owner
// role, `world2_owner`, which is what `replay-ingest` already connects as. Without
// this preflight the failure lands mid-transaction, after the operator has taken
// two dumps and typed three flags, and reads as a permission error on one
// statement rather than as "you are the wrong role for this whole task".
//
// AND IT IS CHECKED BY PLAN SHAPE, NOT BY THE UNION (reviewer, 2026-09-05). The
// first version asked for `UPDATE marks` on every run, so a pure-ADD class would
// have been refused for a grant it never uses. What each shape actually needs:
//
//   ADD    INSERT claims (the admission) + INSERT marks (materializeClaims)
//   AMEND  the above, plus UPDATE marks — the in-place rewrite, and the only
//          reason an amend is not reversible in the first place
//
// Neither shape needs UPDATE on `claims`: an amend INSERTs a new claim that
// supersedes the standing one, it never edits a row. Worth saying because 002's
// `claims_update_guard` exempts only `clearing_job`, so a design that DID update
// claims would be refused by the store no matter which role ran it.
// THE REGISTRY TABLES REPLACED `identities` HERE (POS-160 follow-up, RED 2).
// `materializeClaims → ownerHouseholdFor` used to SELECT one row from
// `identities`; it now asks the ONE DERIVER, which reads the registry itself —
// `households`, `household_pins` and `registry_meta`, the three
// `registry-store.mjs § registryRowsVia` opens. A preflight still naming
// `identities` would pass a role that cannot read the roll and then fail
// mid-transaction on the first claim, which is the whole thing this list exists
// to prevent.
export const READ_PRIVILEGES = [
  ["marks", "SELECT"], ["claims", "SELECT"],
  ["households", "SELECT"],       // materializeClaims → ownerHouseholdFor → the deriver
  ["household_pins", "SELECT"],   //   …the same read, its second table
  ["registry_meta", "SELECT"],    //   …and its third
  ["windows", "SELECT"],
];
export const ADD_PRIVILEGES = [["claims", "INSERT"], ["marks", "INSERT"]];
export const AMEND_PRIVILEGES = [["marks", "UPDATE"]];

/** What this plan needs, in the order a reader would ask it. */
export const privilegesForShape = ({ hasAmends = false } = {}) =>
  [...READ_PRIVILEGES, ...ADD_PRIVILEGES, ...(hasAmends ? AMEND_PRIVILEGES : [])];

/** Kept for callers that want the union; the shape-aware list is the one used. */
export const WRITE_PRIVILEGES = privilegesForShape({ hasAmends: true });

export async function privilegeProbe(client, { hasAmends = false } = {}) {
  const need = privilegesForShape({ hasAmends });
  const checks = need.map(([t, p], i) => `has_table_privilege('${t}', '${p}') AS p${i}`).join(", ");
  const { rows } = await client.query(`SELECT current_user::text AS whoami, ${checks}`);
  const r = rows[0] ?? {};
  return {
    whoami: r.whoami ?? null,
    shape: hasAmends ? "ADD+AMEND" : "ADD",
    checked: need.map(([t, p]) => `${p} ${t}`),
    missing: need.filter((_, i) => !r[`p${i}`]).map(([t, p]) => `${p} on ${t}`),
  };
}

export function privilegeRefusal(p) {
  if (!p.missing.length) return null;
  return `--write refuses: the connection is \`${p.whoami}\` and, for a ${p.shape} plan, it lacks ` +
    `${p.missing.join(", ")}. A backfill INSERTs claims and INSERTs marks (an AMEND plan also UPDATEs ` +
    `marks), and 002_grants gives those halves to DIFFERENT roles — office_api may write claims and ` +
    `not marks, clearing_job may write marks and has UPDATE-only on claims — so neither can do this ` +
    `job. 007 points the same way: \`claims_insert\` is written FOR INSERT TO office_api, so under RLS ` +
    `a role that is neither the owner nor a bypass is refused the insert by POLICY even where the ` +
    `grant exists. Connect as the owner role (\`world2_owner\`), which is what replay-ingest itself ` +
    `uses. Checked BEFORE any dump or write, because a grant error found mid-transaction reads as one ` +
    `failed statement rather than as the wrong role for the whole task.`;
}

// ── THE ONE PLACE `held` FLOWS, so the CLI cannot compute it and drop it ─────
//
// THE BUG THIS EXISTS FOR (reviewer, on the pin): the CLI read the file, used the
// set to LIFT the visibility refusal, and then built `planBackfill`'s options
// WITHOUT it. So `--drafts-held-by-name` looked like it worked — the refusal went
// away, the run proceeded — and held nothing: as `office_api` with all five slugs
// in the file, prod planned ADD 32 and printed no SKIPPED block at all. The
// escape hatch for the worst bug in the lane was itself inert.
//
// The unit test could not have caught it. It called `planBackfill` directly with
// `heldByName`, which is the function the CLI was failing to pass it to — a test
// aimed one layer below the mistake. So the fix is not another assertion, it is
// to REMOVE THE PLACE THE MISTAKE LIVES: preflight and plan happen in one
// function, `held` is its argument, and there is no longer a step between reading
// the file and using it where a caller could forget.
//
// Returns `{ refused, vis, plan }`. `refused` is a string the caller prints and
// exits on; the caller does not decide whether to refuse.
export async function preflightAndPlan(client, {
  worldRepo, sha, windowId, cls, lawSha, townSha, heldByName = null, publishOverDraft = false,
}) {
  const vis = await visibilityProbe(client);
  const refused = visibilityRefusal(vis, { heldByName });
  if (refused) return { refused, vis, plan: null };
  const plan = await planBackfill(client, {
    worldRepo, sha, windowId, cls, lawSha, townSha, heldByName, publishOverDraft,
  });
  plan.cls = cls;
  return { refused: null, vis, plan };
}

/**
 * The receipt, as a string rather than a pile of `console.log`s.
 *
 * A receipt nobody can assert on is a receipt nobody checks. This is what makes
 * "the SKIPPED block names the held slug" a test rather than a hope, and it is
 * the same reasoning as `visibilityLine`: the run's own words, available to the
 * run's own tests.
 */
export function renderPlan(plan, { sha, dbName, windowId }) {
  const out = [];
  out.push(`class ${plan.cls} · world ${String(sha).slice(0, 9)} · db ${dbName} · window ${windowId}`);
  out.push(`register ${plan.registerSize} · store ${plan.storeSize}`);
  out.push(`
ADD ${plan.adds.length}:`);
  for (const a of plan.adds) {
    out.push(`  + ${a.slug}  [${a.mark.kind}/${a.mark.data?.tier ?? "-"}]  ${a.commit.sha} ` +
      `${a.commit.author} — ${String(a.commit.subject).slice(0, 60)}` +
      (a.draftBeside ? `  [a private DRAFT stays beside it — ruled 2026-09-08]` : ""));
  }
  out.push(`
AMEND ${plan.amends.length}:`);
  for (const a of plan.amends) {
    out.push(`  ~ ${a.slug}  fields: ${a.fields.join(", ")}  ${a.commit.sha} ` +
      `${a.commit.author} — ${String(a.commit.subject).slice(0, 60)}` +
      (a.draftBeside ? `  [a private DRAFT stays beside it — ruled 2026-09-08]` : ""));
  }
  if (plan.blockedByParent.length) {
    out.push(`
BLOCKED BY A PARENT IN ANOTHER CLASS ${plan.blockedByParent.length} — \`marks.parent\` ` +
      `is a non-deferrable FK, so these WILL refuse and roll the whole class back unless the ` +
      `parent's class runs first:`);
    for (const b of plan.blockedByParent) {
      out.push(`  ! ${b.slug} — parent ${b.parentSlug} is neither in the store nor in this batch ` +
        `(its class: ${b.parentClass})`);
    }
  }
  if (plan.skipped.length) {
    out.push(`
SKIPPED ${plan.skipped.length} (each says why; none of these is a silent drop):`);
    for (const s of plan.skipped) out.push(`  · ${s.slug} — ${s.why}`);
  }
  return out.join(NL);
}

/** The classes this tool knows how to close. One per invocation, one per commit. */
export const BACKFILL_CLASSES = [
  "hand-planted-on-main",
  "sweep-published-unmirrored",
  "sweep-amend-unmirrored",
  "hand-amend-on-main",
];

const arg = (n, d = null) => {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? d : process.argv[i + 1];
};
const flag = (n) => process.argv.includes(`--${n}`);

/**
 * The rows a class would write, derived from the checkout and the store.
 *
 * ONE FUNCTION, BOTH ARMS. `--dry-run` prints what this returns and `--write`
 * writes what this returns; a rehearsal that measured a different set from the
 * one the write applies is not a rehearsal.
 */
export async function planBackfill(client, { worldRepo, sha, windowId, cls, lawSha, townSha, checkoutDir, heldByName = null, publishOverDraft = false }) {
  // ── THE ORACLE IS BOUND TO `--sha`, NOT TO WHATEVER THE CLONE IS SITTING AT ──
  //
  // This function used to call `deriveSeed({ worldRepo })` — the clone's WORKING
  // TREE — while `sha` fed only the history lookup, and then printed `world <sha>`
  // in the header. Pointed at a full clone parked on world main it derived a
  // different register from the one it claimed, and said nothing. The rehearsal
  // did not catch it because I happened to pass a checkout already at S58, which
  // is exactly the accident that hides this class of bug.
  //
  // Now the register is derived from a detached worktree at `sha`, the same
  // `checkoutAt` the gate uses (`replay-ingest.mjs § checkoutAt`), disposed on
  // every path. A caller that already holds a checkout at that sha may pass
  // `checkoutDir` and own its lifetime; nobody may pass neither.
  const own = checkoutDir ? null : checkoutAt(worldRepo, sha, "backfill");
  const at = checkoutDir ?? own.dir;
  try {
    return await planFrom(client, { worldRepo, checkoutDir: at, sha, windowId, cls, lawSha, townSha, heldByName, publishOverDraft });
  } finally {
    own?.dispose();
  }
}

async function planFrom(client, { worldRepo, checkoutDir, sha, windowId, cls, lawSha, townSha, heldByName = null, publishOverDraft = false }) {
  const derived = await deriveSeed({ worldRepo: checkoutDir, lawSha, townSha });
  const register = new Map(derived.marks.map((m) => [m.slug, m]));

  const dbRows = (await client.query(
    `SELECT id::text, slug, kind, owner, household, body, geometry, bbox::text, status, data
       FROM marks`)).rows;
  const db = new Map(dbRows.map((r) => [r.slug, r]));

  const claimRows = (await client.query("SELECT slug, status FROM claims")).rows;
  // THE DRAFTS THE CONNECTION CAN SEE, PLUS THE ONES IT WAS TOLD ABOUT. Under a
  // role the `claims_read` policy applies to, the first set is EMPTY and says
  // nothing about whether drafts exist — which is why the arm refuses to get here
  // at all unless the connection can see them or `heldByName` was supplied.
  const draftSlugs = new Set([
    ...claimRows.filter((c) => c.status === "draft").map((c) => c.slug),
    ...(heldByName ?? []),
  ]);

  const record = await historyFor({ worldRepo, checkoutDir, sha });

  // ── THE BACKFILL IS DRIVEN BY THE GATE'S OWN FINDINGS, NOT BY A SECOND DIFF ──
  //
  // The first version of this function asked "does the store's row differ from
  // the register's" in its own words — a handful of `!==` over body, geometry,
  // bbox, kind, owner. It looked equivalent and it was not. Its first dry run on
  // a clone of the live store proposed **466 amends** where the gate reports
  // **15**, because it compared `bbox` as a STRING (Postgres' own rendering of a
  // `box` almost never matches the repo's spelling) and compared `geometry`
  // without `stripSlug` (so all 46 pre-006 rows carrying their own slug read as
  // drift). Run on prod it would have rewritten most of the register to close
  // fifteen findings.
  //
  // `compareMarks`' own header says why, and says it about exactly this: "a
  // second copy of this loop is the twin that drifts silently". So the plan is
  // now derived from `compareMarks` under `SUBSTANCE_COLUMNS`, through
  // `standingOnly` and `stripSlug`, which is character for character what
  // `parityFindings` hands the gate. A row this tool proposes to touch is a row
  // the gate is red about, and there is no other way for one to get in here.
  const dbForGate = standingOnly(dbRows).map((r) => ({ ...r, geometry: stripSlug(r.geometry) }));
  const findings = compareMarks(dbForGate, derived.marks, { columns: SUBSTANCE_COLUMNS });
  const fieldsBySlug = new Map();
  for (const line of findings) {
    const f = parseFinding(line);
    if (!f || f.kind !== "differs") continue;
    if (!fieldsBySlug.has(f.slug)) fieldsBySlug.set(f.slug, new Set());
    fieldsBySlug.get(f.slug).add(f.field);
  }
  const missingSlugs = new Set(
    findings.map((l) => parseFinding(l)).filter((f) => f?.kind === "missing").map((f) => f.slug));

  const adds = [], amends = [], skipped = [];
  for (const slug of [...missingSlugs, ...fieldsBySlug.keys()]) {
    const m = register.get(slug);
    if (!m) continue;                                   // EXTRA is never a backfill
    const isMissing = missingSlugs.has(slug);
    const rec = record(slug);
    const commit = isMissing ? rec?.addedBy : rec?.changedBy;
    if (!commit) { skipped.push({ slug, why: "no commit on the compared tag's ancestry names this mark's file" }); continue; }
    const cause = isMissing
      ? (isSweepCommit(commit) ? "sweep-published-unmirrored" : "hand-planted-on-main")
      : (isSweepCommit(commit) ? "sweep-amend-unmirrored" : "hand-amend-on-main");
    if (cause !== cls) continue;

    if (REFUSED_BY_NAME.has(slug)) { skipped.push({ slug, why: "HELD by the founder's word — refused by name" }); continue; }
    // RULED 2026-09-08: a private draft never blocks the published body. Without
    // the flag the skip stands (the default is still the resident's); with it the
    // row is planned and the receipt says a draft stays beside it.
    const draftBeside = draftSlugs.has(slug);
    if (draftBeside && !publishOverDraft) {
      const byName = heldByName?.has(slug) ? " (held BY NAME — this connection cannot see the claim itself)" : "";
      skipped.push({ slug, why: `the store holds a private DRAFT for this slug — a ruling, not a backfill${byName}` });
      continue;
    }

    if (isMissing) {
      adds.push({ slug, mark: m, commit, cause, draftBeside });
    } else {
      amends.push({
        slug, mark: m, was: db.get(slug), commit, cause, draftBeside,
        fields: [...fieldsBySlug.get(slug)].sort(),
      });
    }
  }

  // ── PARENTS THAT CROSS A CLASS BOUNDARY (the thing that would blow up on prod) ─
  //
  // `marks.parent` is a self-referencing FK and it is NOT deferrable (004).
  // `orderByParent` sorts within a batch, which is enough for the clearing job
  // because a window's claims arrive together. A backfill does NOT arrive
  // together: it is one class per commit, by ruling, so a child in
  // `sweep-published-unmirrored` whose parent is in `hand-planted-on-main` will
  // be refused mid-transaction and roll the whole class back — at the moment the
  // conductor is typing on prod, with no dry run having said so.
  //
  // The dry run says so. Reported, never auto-ordered: reordering the classes
  // silently would be this tool choosing the ruling's own sequencing.
  const inBatch = new Set(adds.map((a) => String(a.mark.id)));
  const inStore = new Set(dbRows.map((r) => String(r.id)));
  const blockedByParent = adds
    .filter((a) => a.mark.parent && !inBatch.has(String(a.mark.parent)) && !inStore.has(String(a.mark.parent)))
    .map((a) => {
      const parent = derived.marks.find((m) => String(m.id) === String(a.mark.parent));
      const prec = parent ? record(parent.slug) : null;
      const pc = prec?.addedBy;
      return {
        slug: a.slug,
        parentSlug: parent?.slug ?? String(a.mark.parent),
        parentClass: pc ? (isSweepCommit(pc) ? "sweep-published-unmirrored" : "hand-planted-on-main") : "unknown",
      };
    });

  return { adds, amends, skipped, blockedByParent, registerSize: register.size, storeSize: db.size };
}

/**
 * The admission a backfilled row carries — DEC-17's shape, with its source named.
 *
 * ── THE STAMP IS `_source`, NOT `source` (RULED 2026-09-12) ──────────────────
 *
 * Keemin, 2026-09-12: "we can have the underscore `_source` to differentiate. I
 * think that's fine."
 *
 * `source` IS A RESIDENT'S WORD. Measured on prod 2026-09-12 against world main
 * `7ffa420f`: 32 standing rows carry `source` as a STRING and the file carries
 * that same line on all 32 — a LOGOS pointer ("LOGOS/classes.md", "WRITES.md").
 * This function wrote its provenance into the SAME key on 146 rows, so on the
 * one row that had both — `the-town/the-reach`, whose file reads
 * `source: LOGOS/classes.md` — the stamp did not sit beside the author's line,
 * it REPLACED it.
 *
 * The town already has a word for a key the store owns: the underscore prefix
 * (`_origin`, `_parentMarkId`, `_fileAt`, `_stray`, `_act_id` …), and
 * `src/mark-record.mjs:283` is its one enforcer — `!k.startsWith("_")` — so a
 * key named this way can never be written onto a resident's `mark.md`. That is
 * the whole reason for the rename: the guard becomes structural instead of
 * value-shaped.
 *
 * THE 146 ROWS ALREADY IN THE STORE move by `world2/schema/017_source_underscore.sql`,
 * which is run by hand between candle runs. This function and that migration
 * ship in the same commit; running one without the other leaves the store
 * carrying both spellings, which no reader would notice, because there is no
 * reader — see the migration's header for the search that establishes that.
 */
export const backfillAdmission = (m, commit, cause) => ({
  status: "locked",
  decided_at: commit.at,
  data: {
    ...(m.data ?? {}),
    locked_by: "founder",
    founder_commit: { sha: commit.sha, subject: commit.subject, at: commit.at },
    _source: {
      kind: isSweepCommit(commit) ? "sweep" : "hand",
      sha: commit.sha, subject: commit.subject, at: commit.at,
      backfill: cause,
    },
  },
});

const amendId = (slug, windowId) => uuid5(`amend:${windowId}:${slug}`);

export async function applyBackfill(client, plan, { windowId, recompute = false }) {
  const q = (text, args) => client.query(text, args);
  const claims = [];
  const amendMap = new Map();

  for (const a of plan.adds) {
    claims.push({
      id: a.mark.id, window_id: windowId, slug: a.slug, class: a.mark.kind,
      claimant: a.mark.owner, household: a.mark.household, submitted_at: new Date(a.commit.at),
      body: a.mark.body, geometry: a.mark.geometry, bbox: a.mark.bbox, stake: 0,
      parent: a.mark.parent, supersedes: null,
      ...backfillAdmission(a.mark, a.commit, a.cause),
    });
  }
  for (const am of plan.amends) {
    const id = amendId(am.slug, windowId);
    claims.push({
      id, window_id: windowId, slug: am.slug, class: am.mark.kind,
      claimant: am.mark.owner, household: am.mark.household, submitted_at: new Date(am.commit.at),
      body: am.mark.body, geometry: am.mark.geometry, bbox: am.mark.bbox, stake: 0,
      parent: am.mark.parent, supersedes: am.was.id,
      ...backfillAdmission(am.mark, am.commit, am.cause),
    });
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
  const n = await materializeClaims(q, { claims, amends: amendMap, windowId, label: `backfill ${plan.cls ?? ""}` });

  // ── THE STANDING RECOMPUTE IS OPT-IN, AND THAT IS THE POINT ────────────────
  //
  // `recomputeStanding` rewrites `data.tier` for EVERY standing mark, not just
  // the ones this backfill added — that is what it is for, and inside the
  // clearing job's transaction it is exactly right. Here it is not obviously
  // right: a backfill's remit is "add what 1.0 already published", and moving a
  // thousand tiers is a second act with its own consequences. The replay makes
  // the same call for the mirror-image reason ("`recomputeStanding` is
  // deliberately NOT called: the clearing job runs it for every standing mark at
  // (d) … writing tier twice is how it went stale before").
  //
  // So: off by default, and the run says what it left undone rather than leaving
  // the reader to notice. With it off, new rows carry the tier the checkout
  // derived; the next clearing candle recomputes them anyway. With it on, the
  // `stale-tier` finding closes in the same commit.
  const standing = recompute ? await recomputeStanding(q) : null;
  return { materialized: n, standing };
}

// ── the arm ──────────────────────────────────────────────────────────────────

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  const cls = arg("class");
  if (!BACKFILL_CLASSES.includes(cls)) {
    console.error(`--class must be one of: ${BACKFILL_CLASSES.join(", ")}`);
    process.exit(2);
  }
  const worldRepo = resolve(arg("world-repo") ?? (() => { throw new Error("--world-repo is required"); })());
  const sha = arg("sha") ?? execFileSync("git", ["-C", worldRepo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  // THE PG* SHAPE IS THE ONE THE OWNER ARRIVES IN. `WORLD2_PG_URL` is the
  // OFFICE's connection — `office_api`, which by 002_grants may not write `marks`
  // at all — and defaulting to it is how this tool came to be pointed at a role
  // that could neither see the drafts nor do the write. `replay-ingest` connects
  // with a bare `new pg.Client()` and takes PGHOST/PGDATABASE/PGUSER/PGPASSWORD,
  // which is what `world2-lib.sh`'s `w2_pgenv world2_owner PG_WORLD2_OWNER_PASSWORD`
  // exports. This accepts both and prefers the explicit one.
  const url = arg("pg-url") ?? (process.env.PGUSER ? null : process.env.WORLD2_PG_URL);
  if (!url && !process.env.PGDATABASE) {
    console.error("no --pg-url, no PG* environment, and no WORLD2_PG_URL. For the owner role:\n" +
      "  . /srv/world2-lab/ops/world2-lib.sh && w2_pgenv world2_owner PG_WORLD2_OWNER_PASSWORD");
    process.exit(2);
  }

  const dbName = url
    ? decodeURIComponent(new URL(url).pathname.replace(/^\//, ""))
    : process.env.PGDATABASE;
  const looksLab = /lab|scratch/i.test(dbName);
  const write = flag("write");
  if (write) {
    if (!flag("i-have-the-founders-word")) {
      console.error("--write requires --i-have-the-founders-word");
      process.exit(2);
    }
    if (!looksLab && !flag("prod")) {
      console.error(`--write refuses database "${dbName}": its name contains neither "lab" nor "scratch". ` +
        `Pass --prod as WELL as --write if this is deliberate. (On the box there is no separate lab store: ` +
        `/srv/world2-lab/lab.env and /etc/postmark-office.env both name world2_dev.)`);
      process.exit(2);
    }
  }

  const client = url ? new pg.Client({ connectionString: url }) : new pg.Client();
  await client.connect();

  // ── THE TWO PREFLIGHTS, BEFORE A PLAN IS DERIVED OR A DUMP IS TAKEN ───────
  // A NAME SURVIVES A POLICY; A STATUS DOES NOT. One slug per line, blank lines
  // and `#` comments ignored, so the file can say who these people are.
  const held = arg(DRAFTS_FLAG)
    ? new Set(heldSlugsFrom(readFileSync(arg(DRAFTS_FLAG), "utf8")))
    : null;

  // ── THE VISIBILITY PREFLIGHT — BOTH ARMS, ALWAYS ─────────────────────────
  //
  // Runs before a plan is derived, on the dry run exactly as on the write. A
  // preflight that fired only on the dry run would be backwards: the run that
  // can do harm would be the unchecked one. And the line it prints carries
  // `current_user` beside the database and the visible draft count, so a dry
  // run's receipt and a write's receipt can be laid side by side and SEEN to be
  // the same eyes — which is the only way to know the dry run described the
  // write, given that a role which bypasses RLS and one that does not will
  // honestly report different plans from the same store.
  const w = await client.query("SELECT id, law_sha, town_sha FROM windows WHERE status = 'open' ORDER BY id DESC LIMIT 1");
  const windowId = Number(arg("window", w.rows[0]?.id));

  // ONE CALL. The preflight and the plan are the same step, and `held` is its
  // argument — see `preflightAndPlan` for the bug that shape exists to make
  // impossible. The CLI no longer has a place to compute the hold and forget it.
  const { refused, vis, plan } = await preflightAndPlan(client, {
    worldRepo, sha, windowId, cls, heldByName: held, publishOverDraft: flag(PUBLISH_OVER_DRAFT_FLAG),
    lawSha: arg("law-sha", w.rows[0]?.law_sha ?? "0".repeat(40)),
    townSha: arg("town-sha", w.rows[0]?.town_sha ?? null),
  });
  console.log(visibilityLine(vis, held));
  if (refused) { console.error(`\n${refused}`); await client.end(); process.exit(2); }

  console.log(renderPlan(plan, { sha, dbName, windowId }));

  // THE AMEND REFUSAL IS CHECKED AFTER THE PLAN AND BEFORE THE TRANSACTION, so a
  // refused run still prints the whole dry-run listing above — the operator sees
  // exactly what was refused rather than a bare error.
  const refusal = refusalFor({
    amendCount: plan.amends.length,
    recompute: flag("recompute-standing"),
    accepted: flag(AMEND_FLAG),
  });

  if (!write) {
    console.log(`\n--dry-run: nothing was written. Re-run with --write --i-have-the-founders-word` +
      `${looksLab ? "" : " --prod"}${refusal ? ` --${AMEND_FLAG}` : ""} to apply.`);
    if (refusal) console.log(`\nNOTE — under --write this plan would be REFUSED:\n  ${refusal}`);
    await client.end();
    process.exit(0);
  }

  if (refusal) {
    console.error(`\n${refusal}`);
    await client.end();
    process.exit(2);
  }

  // ── THE PRIVILEGE PREFLIGHT — AFTER THE PLAN, BECAUSE IT ASKS BY SHAPE ────
  //
  // A pure-ADD plan needs INSERT on claims and marks; only an AMEND plan needs
  // UPDATE on marks. Checking the union would refuse a class for a grant it never
  // uses, which is a false refusal and teaches an operator to reach for a bigger
  // role than the work wants. So it runs here, where `plan.amends.length` is
  // known — still before the transaction, and still before the dumps are spent.
  // It REPORTS on both arms and REFUSES only on `--write`: a dry run needs no
  // grant beyond SELECT, so refusing one would be a false refusal — but a dry run
  // that stays silent about a grant the write will need has told the operator
  // nothing until the moment it costs something.
  const priv = await privilegeProbe(client, { hasAmends: plan.amends.length > 0 });
  const pr = privilegeRefusal(priv);
  console.log(pr
    ? `privileges for ${priv.whoami} · ${priv.shape} plan · MISSING ${priv.missing.join(", ")}` +
      `${write ? "" : " — this dry run does not need them; the write would be refused"}`
    : `privileges OK for ${priv.whoami} · ${priv.shape} plan · ${priv.checked.join(", ")}`);
  if (pr && write) { console.error(`\n${pr}`); await client.end(); process.exit(2); }

  await client.query("BEGIN");
  try {
    const { materialized, standing } = await applyBackfill(
      client, plan, { windowId, recompute: flag("recompute-standing") });
    await client.query("COMMIT");
    console.log(`\nWROTE ${materialized} mark(s) under window ${windowId}, each behind a locked claim naming its ` +
      `source commit.`);
    // `recomputeStanding` returns ARRAYS (`standing`, `moved`) and notes, not
    // counts. Printing them straight put `[object Object]` three hundred times
    // into the rehearsal receipt; length is what a reader wants and the moved
    // rows are what a reviewer wants, so print both, bounded.
    console.log(standing
      ? `standing recomputed: ${standing.moved.length} tier(s) moved across ${standing.standing.length} standing ` +
        `mark(s)${standing.moved.length ? ` — ${standing.moved.slice(0, 5).map((m) => `${m.slug ?? m.id}:${m.from ?? "?"}→${m.to ?? m.tier ?? "?"}`).join(", ")}` : ""}` +
        `${standing.notes?.length ? `\n  ${standing.notes.length} standing note(s): ${standing.notes.slice(0, 2).join("; ")}` : ""}`
      : `standing NOT recomputed (pass --recompute-standing to close \`stale-tier\` in this commit); the next ` +
        `clearing candle recomputes tier for every standing mark anyway.`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(`\nROLLED BACK — nothing was written: ${err.message}`);
    await client.end();
    process.exit(1);
  }
  await client.end();
}
