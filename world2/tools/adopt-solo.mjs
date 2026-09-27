#!/usr/bin/env node
// adopt-solo.mjs — THE HOUSES THAT STAND ADOPT THEIR PEOPLE'S `solo:` MARKS, ONCE
// (postmark POS-212, w40 · Keemin's ruling 2026-09-23: "solo: adoption at the
// ceremony + one office batch, grandfather over-cap houses, count after").
//
//   node world2/tools/adopt-solo.mjs --world-repo <checkout> [--dry-run]
//
//   env: PG* (the owner role), exactly as marks-ingest and backfill-register take it:
//        `. world2-lib.sh && w2_pgenv world2_owner PG_WORLD2_OWNER_PASSWORD`
//
// EXIT: 0 adopted, dry-run, or nothing to adopt · 1 REFUSED (a STOP, a missing
//       privilege, no open window, a failed house — named) · 2 a bad argument.
//
// ── WHAT IT DOES ────────────────────────────────────────────────────────────
//
// Lists every standing mark spelled `solo:<x>` where `<x>` is held by a
// declared house (the spelling set `household-deriver.mjs § houseKeysOf`
// builds from `households` + `household_pins`), with the house it goes to.
// Without `--dry-run` it adopts them — `src/solo-adoption.mjs § planAdoption`
// is the plan, the same one the ceremony runs — in ONE TRANSACTION PER HOUSE,
// writing ONE RECEIPT ACT PER HOUSE. When every house has committed, it writes
// the one store fact the parcel cap's count flips on (`solo-counted`, below).
//
// ── THE WRITE IS marks-ingest's AMEND, NOT A NEW ONE ─────────────────────────
//
// marks-ingest.mjs, quoted: "AMEND  a NEW `locked` claim whose `supersedes` is
// the standing mark's id …, then `materializeClaims` REWRITES the row in place
// … Every version stays in the log: each is its own claim row." This tool
// builds that claim from the standing mark's OWN bytes (kind, owner, body,
// geometry, bbox, parent, data) and hands it to the SAME `materializeClaims`,
// which re-derives `marks.household` from the owner (`ownerHouseholdFor`, "NOT
// c.household"). No UPDATE of `marks.household` is written by this file.
//
// Then, inside the same house's transaction, the STANDING RECOMPUTE — "the last
// act of anything that added ground" (materialize.mjs). A parcel changing house
// is ground changing hands: the marks on it may move `market → home`. A crossing
// runs it after the ceremony's claims; the batch runs it after each house.
//
// ── THE GRANDFATHER ─────────────────────────────────────────────────────────
//
// A house whose held + adopted parcels exceed the cap is adopted ANYWAY and
// LISTED under OVER CAP in the dry run and in its receipt act. Nothing is
// withdrawn and nothing is refused. The cap binds NEW parcels only from here:
// after `solo-counted`, the clearing's step 5.6 counts these rows and refuses a
// new parcel to a house at or over the cap in the sentence it already speaks.
// The cap is READ FROM THE WORLD (`parcel-cap.mjs § parcelCapLawAt`), never
// copied — which is why `--world-repo` is required, dry or not.
//
// ── IDEMPOTENT ──────────────────────────────────────────────────────────────
//
// A second run finds no `solo:` row a house holds (each was re-grained) and the
// `solo-counted` act already present, and writes nothing. Each claim's id is
// `uuid5("solo-adoption:<mark id>:<house key>")`, so a re-derivation names the
// same claim, and a replayed write meets the primary key rather than filing a
// second version. A mark the CEREMONY already filed a pending adoption for is
// listed PENDING and left for the crossing that rules it.
//
// ── THE COUNT FLIPS AFTER THE BATCH, AND ONLY WHERE IT RAN ──────────────────
//
// `solo-counted` is an ACT (class `household`), written once, after the last
// house commits. Acts are append-only, so the fact can exist only on a store
// where this batch actually ran, and nothing can un-set it. The clearing reads
// it (`parcel-cap.mjs § soloCountedAt`) and from then on counts a `solo:` row
// as the house's. It is written even when no mark needed adopting — the batch
// ran, and there is nothing left uncounted. A run that stops on a failed house
// does NOT write it: the count must never flip over a store that still holds
// `solo:` parcels the batch meant to adopt.
//
// ── THE DRY RUN READS; IT CANNOT WRITE ──────────────────────────────────────
//
// `BEGIN READ ONLY` (marks-ingest's shape): Postgres itself refuses any write,
// and the SAME plan the run would carry is printed.

import { existsSync, realpathSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";

import { uuid5 } from "./seed-import.mjs";
import { materializeClaims, recomputeStanding } from "./materialize.mjs";
import { parcelCapLawAt } from "./parcel-cap.mjs";
import { fractionalCrossing } from "./live-reads.mjs";
import { houseRowsVia } from "../../src/household-deriver.mjs";
import {
  planAdoption, renderAdoption, adoptionEffect, soloCountedAt,
  SOLO_MARKS_SQL, PARCEL_SPELLINGS_SQL, PENDING_ADOPTIONS_SQL,
  ADOPT_CLASS, ADOPT_ACTION, COUNTED_ACTION, ADOPTED_KEY,
} from "../../src/solo-adoption.mjs";

export const CAUSE = "solo-adoption";
const NL = String.fromCharCode(10);

/** An adoption claim's id: deterministic, so a replay names the same claim. */
export const adoptionClaimId = (markId, key) => uuid5(`${CAUSE}:${markId}:${key}`);

export const OPEN_WINDOW_SQL = "SELECT id FROM windows WHERE status = 'open' ORDER BY id DESC LIMIT 1";

/** What the write needs, checked before it writes (marks-ingest § missingPrivileges' shape). */
export const WRITE_PRIVILEGES = [
  ["marks", "SELECT"], ["marks", "UPDATE"], ["claims", "SELECT"], ["claims", "INSERT"],
  ["acts", "SELECT"], ["acts", "INSERT"], ["windows", "SELECT"],
  ["households", "SELECT"], ["household_pins", "SELECT"], ["registry_meta", "SELECT"],
];

export async function missingPrivileges(q) {
  const checks = WRITE_PRIVILEGES.map(([t, p], i) => `has_table_privilege('${t}', '${p}') AS p${i}`).join(", ");
  const { rows: [r] } = await q(`SELECT current_user::text AS whoami, ${checks}`);
  return { whoami: r?.whoami ?? null, missing: WRITE_PRIVILEGES.filter((_, i) => !r?.[`p${i}`]).map(([t, p]) => `${p} on ${t}`) };
}

export const ACT_SQL = `
  INSERT INTO acts (at, crossing, actor, action, object, class, payload, effect, household)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id::text AS id`;

/** The claim `marks-ingest § applyIngest` writes, carrying the standing mark's own bytes. */
export const CLAIM_SQL = `
  INSERT INTO claims (id, window_id, slug, class, claimant, household, submitted_at,
                      status, decided_at, body, geometry, bbox, stake, data, parent, supersedes)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`;

const js = (v) => (v == null ? null : typeof v === "string" ? v : JSON.stringify(v));
const parsed = (v) => (typeof v === "string" ? JSON.parse(v) : v);

/**
 * The house's marks, RE-READ AND LOCKED inside its own transaction. The plan was
 * read in a transaction of its own, and a resident may amend a mark in between;
 * a claim built from the plan's copy would then write the older bytes over the
 * newer. So the claim is built from THIS read, and a mark that is no longer a
 * standing `solo:` row is simply not adopted.
 */
export const LOCK_SQL = `
  SELECT id::text AS id, slug, kind, owner, household, body, geometry, bbox,
         parent::text AS parent, data, status
    FROM marks
   WHERE id = ANY($1::uuid[]) AND status = 'standing' AND household LIKE 'solo:%'
   ORDER BY slug
     FOR UPDATE`;

/**
 * Adopt ONE house, inside the caller's transaction. Returns `{ act, claims, moved }`,
 * or `null` when none of its marks is still a standing `solo:` row.
 */
export async function adoptHouse(q, planned, { windowId, at = new Date(), cap = null }) {
  const { rows: fresh } = await q(LOCK_SQL, [planned.marks.map((m) => String(m.id))]);
  if (!fresh.length) return null;
  const house = { ...planned, marks: fresh, from: [...new Set(fresh.map((m) => m.household))].sort() };
  const payload = {
    house: house.key, from: house.from, marks: house.marks.map((m) => m.slug),
    parcels: house.parcels, cap, over_cap: house.overCap,
    ...(house.overCap ? { grandfathered: "adopted anyway; the cap binds NEW parcels only from here" } : {}),
  };
  const { rows: [act] } = await q(ACT_SQL, [
    at.toISOString(), fractionalCrossing(at.getTime()), CAUSE, ADOPT_ACTION, house.key, ADOPT_CLASS,
    JSON.stringify(payload),
    adoptionEffect(house.slug, house.marks.length, house.from) + (house.overCap ? " — OVER CAP, grandfathered" : ""),
    house.key,
  ]);

  const claims = [];
  const amends = new Map();
  for (const m of house.marks) {
    const id = adoptionClaimId(m.id, house.key);
    const data = { ...(parsed(m.data) ?? {}), [ADOPTED_KEY]: { from: m.household, to: house.key, at: CAUSE }, _act_id: String(act.id) };
    const c = {
      id, window_id: windowId, slug: m.slug, class: m.kind, claimant: m.owner, household: house.key,
      submitted_at: at, status: "locked", decided_at: at, body: m.body ?? null,
      geometry: parsed(m.geometry), bbox: m.bbox, stake: 0, data, parent: m.parent ?? null, supersedes: String(m.id),
    };
    await q(CLAIM_SQL, [c.id, c.window_id, c.slug, c.class, c.claimant, c.household, c.submitted_at,
      c.status, c.decided_at, c.body, js(c.geometry), c.bbox, c.stake, JSON.stringify(c.data), c.parent, c.supersedes]);
    claims.push(c);
    amends.set(String(id), { id: String(m.id) });
  }
  await materializeClaims(q, { claims, amends, windowId, label: `${CAUSE} ${house.key}` });
  const standing = await recomputeStanding(q);
  return { act: act.id, claims: claims.map((c) => c.id), moved: standing.moved };
}

/**
 * The batch. `client` is a pg client. `law` is `parcelCapLawAt`'s answer (a
 * suite passes its own). Never throws on a STOP — it refuses with the reason.
 */
export async function adoptSolo(client, { law, dryRun = false, log = () => {}, now = () => new Date() } = {}) {
  if (!law?.cap) return { status: "refused", receipt: "REFUSED: no parcel-cap law — the grandfather list is judged against the world's cap, and this tool never supplies one" };
  const q = (text, args) => client.query(text, args);

  // ── the read, and the plan (both arms) ──
  await q(dryRun ? "BEGIN READ ONLY" : "BEGIN");
  let plan, counted, windowId;
  try {
    const houseRows = await houseRowsVia({ query: q });
    const { rows: solo } = await q(SOLO_MARKS_SQL);
    const { rows: parcels } = await q(PARCEL_SPELLINGS_SQL);
    const { rows: pend } = await q(PENDING_ADOPTIONS_SQL);
    counted = await soloCountedAt(q);
    const { rows: [w] } = await q(OPEN_WINDOW_SQL);
    windowId = w ? Number(w.id) : null;
    plan = planAdoption({
      marks: [...solo, ...parcels], registry: houseRows.registry, pins: houseRows.pins,
      pending: new Set(pend.map((r) => String(r.id))), cap: law.cap,
    });
  } finally {
    await q("ROLLBACK");
  }

  const receipt = renderAdoption(plan, { header: `adopt-solo · cap ${law.cap} (world ${String(law.sha ?? "?").slice(0, 8)})` }) +
    `${NL}count: ${counted ? "solo: rows ALREADY COUNTED at the cap (solo-counted is on the record)" : "solo: rows not yet counted — flips when this batch completes"}`;
  log(receipt);
  const n = plan.houses.reduce((s, h) => s + h.marks.length, 0);
  const summary = { houses: plan.houses.length, marks: n, over_cap: plan.houses.filter((h) => h.overCap).map((h) => h.key),
    pending: plan.pending.length, held: plan.held.length, orphans: plan.orphans.length, stops: plan.stops.length, counted };

  if (plan.stops.length) return { status: "refused", plan, summary, receipt: `${receipt}${NL}${NL}REFUSED: ${plan.stops.length} STOP(s) — nothing was written` };
  if (dryRun) return { status: "dry-run", plan, summary, receipt: `${receipt}${NL}${NL}--dry-run: read inside BEGIN READ ONLY; nothing was written` };
  if (!n && counted) return { status: "noop", plan, summary, receipt: `${receipt}${NL}${NL}nothing to adopt, and the count already counts — a second run is a no-op` };
  if (n && windowId == null) return { status: "refused", plan, summary, receipt: `${receipt}${NL}${NL}REFUSED: no open window — a version is ruled at a window, and the candle is dark` };

  const priv = await missingPrivileges(q);
  if (priv.missing.length) {
    return { status: "refused", plan, summary, receipt: `${receipt}${NL}${NL}REFUSED: the connection is \`${priv.whoami}\` and lacks ${priv.missing.join(", ")}. ` +
      "Adoption INSERTs claims and acts and rewrites marks; 002_grants gives those halves to different roles, so connect as the owner (`world2_owner`), as marks-ingest does." };
  }

  // ── one transaction per house ──
  const done = [];
  for (const house of plan.houses) {
    await q("BEGIN");
    try {
      const r = await adoptHouse(q, house, { windowId, at: now(), cap: law.cap });
      await q("COMMIT");
      if (!r) continue;   // every mark moved between the plan and this house's lock — nothing to adopt
      done.push({ house: house.key, act: r.act, marks: house.marks.length, over_cap: house.overCap, moved: r.moved.length });
    } catch (err) {
      await q("ROLLBACK").catch(() => {});
      return {
        status: "refused", plan, summary, done,
        receipt: `${receipt}${NL}${NL}REFUSED at ${house.key}: ${err?.message ?? err} — that house rolled back whole; ` +
          `${done.length} house(s) before it committed (${done.map((d) => d.house).join(", ") || "none"}). ` +
          "solo-counted was NOT written, so the cap still does not count solo: rows. Fix the named house and run again: the committed houses are a no-op the second time.",
      };
    }
  }

  // ── the store fact the count flips on — after every house, once ──
  if (!counted) {
    await q("BEGIN");
    try {
      const at = now();
      await q(ACT_SQL, [at.toISOString(), fractionalCrossing(at.getTime()), CAUSE, COUNTED_ACTION, "solo:", ADOPT_CLASS,
        JSON.stringify({ houses: done.map((d) => d.house), marks: n, over_cap: summary.over_cap }),
        "every house has adopted its people's solo: marks; from this act the parcel cap counts a solo: row as its house's",
        null]);
      await q("COMMIT");
    } catch (err) {
      await q("ROLLBACK").catch(() => {});
      return { status: "refused", plan, summary, done, receipt: `${receipt}${NL}${NL}ADOPTED ${done.length} house(s), but solo-counted FAILED: ${err?.message ?? err} — run again; adoption is a no-op the second time and the fact will be written.` };
    }
  }
  return {
    status: "adopted", plan, summary, done,
    receipt: `${receipt}${NL}${NL}ADOPTED ${n} mark(s) into ${done.length} house(s), one receipt act each` +
      `${summary.over_cap.length ? ` · over cap, grandfathered: ${summary.over_cap.join(", ")}` : ""}` +
      ` · solo-counted ${counted ? "was already on the record" : "written"}`,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const argOf = (name) => { const i = process.argv.indexOf(name); return i !== -1 ? process.argv[i + 1] : null; };

async function main() {
  const worldRepo = argOf("--world-repo");
  if (!worldRepo || !existsSync(worldRepo)) {
    console.error("usage: adopt-solo.mjs --world-repo <checkout> [--dry-run]   (the cap is the world's law, read from the checkout)");
    process.exit(2);
  }
  if (!process.env.PGDATABASE && !process.env.PGUSER) {
    console.error("no PG* environment. For the owner role:\n  . /srv/world2-lab/ops/world2-lib.sh && w2_pgenv world2_owner PG_WORLD2_OWNER_PASSWORD");
    process.exit(2);
  }
  const law = await parcelCapLawAt(worldRepo);
  const { default: pg } = await import("pg");
  const client = new pg.Client();
  await client.connect();
  try {
    const r = await adoptSolo(client, { law, dryRun: process.argv.includes("--dry-run") });
    console.log(r.receipt);
    console.log(JSON.stringify({ status: r.status, ...r.summary }));
    process.exitCode = r.status === "refused" ? 1 : 0;
  } catch (e) {
    console.error(`ADOPT-SOLO FAILED: ${e?.message ?? e}`);
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

