// solo-adoption.mjs — A HOUSE ADOPTS THE MARKS ITS PEOPLE PLACED BEFORE IT HAD A KEY
// (postmark POS-212, w40 · Keemin's ruling 2026-09-23 18:4x: "solo: adoption at
// the ceremony + one office batch, grandfather over-cap houses, count after").
//
// ── WHAT `solo:` IS, AND WHY IT IS PRUNED RATHER THAN KEPT ─────────────────
//
// Before the join ceremony minted household keys (POS-158/187), a mark whose
// author the roster could not place was filed as `solo:<handle>` (or
// `solo:<login>` — `materialize.mjs § the ownership grain` names both). The pen
// stopped minting them in #166 (RED 2: "it refuses a houseless claimant, it
// does not fall back"). #166 also put every `solo:<held>` spelling into its
// house's SPELLING SET (RULING 4), so those rows are READ as the house's — but
// `resolveHouse` still answers `unknown` for them, so the parcel cap never
// COUNTED them (POS-160's pin, FALSIFIER 3d). Keemin's stance on the design:
// `solo:` is poor design to be pruned, and the ruling is ADOPTION.
//
// ── THE STORE'S AMENDMENT SHAPE, MEASURED, AND MIRRORED ─────────────────────
//
// A row's household spelling is not rewritten by an UPDATE of its own. Three
// guards say so for three tables (024's header): `acts_append_only`,
// `claims_update_guard` ("a claim's household never changes"), and on `marks`
// the one lawful write shape, which is a VERSION:
//
//   world2/tools/marks-ingest.mjs:
//     "AMEND   a NEW `locked` claim whose `supersedes` is the standing mark's id
//              (001: "amend-chain resolution"), then `materializeClaims` REWRITES
//              the row in place — `marks.slug` is UNIQUE, so one copy, ever — and
//              moves `locked_window` to the window that ruled this version. Every
//              version stays in the log: each is its own claim row."
//
//   src/world2-claims.mjs (the door's amend, #2806):
//     "NO PENDING PRIOR IN THIS WINDOW → THE STANDING MARK IS WHAT IT AMENDS …
//      supersedes = standing?.id"
//
//   world2/tools/materialize.mjs § materializeClaims:
//     `const grain = await ownerHouseholdFor(q, c.claimant); // NOT c.household`
//
// So adoption is an AMEND THAT CHANGES NOTHING THE RESIDENT AUTHORED: a new
// claim carrying the standing mark's every byte (kind, owner, body, geometry,
// bbox, parent, data), superseding it. When it is materialized, the row is
// rewritten in place and its household is re-derived from its OWNER — who now
// stands in a house — so `solo:<x>` becomes `hh:<slug>` by the pen's own grain,
// not by anything this file writes into that column. The prior version stays in
// the log as its own claim row. The `solo:` spelling stays in the house's set
// (`household-deriver.mjs § houseKeysOf`), so every old reference still reads.
//
// ── TWO ARMS, ONE PLAN, AND WHY THEY RULE AT DIFFERENT MOMENTS ──────────────
//
// `planAdoption` below is the ONE function that decides what is adopted, into
// which house, and which houses stand over the cap. Two writers carry it out:
//
//   THE CEREMONY (this file, `adoptAtCeremony`). The ceremony's pen is the
//   office's ONE pool, role `office_api` (`registry-store.mjs`). 002_grants
//   gives `office_api` INSERT on `acts` and `claims` — and NO write on `marks`,
//   which is `clearing_job`'s alone. So the ceremony does exactly what the door
//   does for any amend: it files a PENDING claim superseding the standing mark,
//   in one statement with its act, and the next crossing's clearing locks and
//   materializes it (step 1 reads `supersedes` as an amend, step 4 excludes the
//   mark's own ground, step 5.6 counts it `amending` and never refuses it).
//   Adoption at the ceremony therefore LANDS at the next crossing, the way every
//   door-made change to a mark lands. That is the store's law, not a delay this
//   lane chose: a ceremony that wrote `marks` directly would be a fourth pen.
//
//   THE BATCH (`world2/tools/adopt-solo.mjs`), run once by an operator as
//   `world2_owner` — the role `marks-ingest` and `backfill-register` connect as,
//   because it is the one role holding both halves. It is `marks-ingest`'s AMEND
//   exactly: `locked` claims, `materializeClaims`, one transaction per house,
//   plus the standing recompute a crossing would run.
//
// ── WHAT A PLAN WILL NOT ADOPT, EACH NAMED ─────────────────────────────────
//
//   ORPHANED       a `solo:` spelling no house holds. After POS-159's backfill
//                  there should be none; if there is one it is a person's row to
//                  look at, and it is left standing exactly as it is.
//   AMBIGUOUS      a `solo:` spelling two houses hold. #166's census measured 0 of
//                  304; the plan refuses to choose (a STOP).
//   OWNER ELSEWHERE a mark whose OWNER stands in a different house from the one
//                  its spelling names. `materializeClaims` grains by the owner, so
//                  adopting it would file it in the owner's house — not the house
//                  the plan says. HELD for a person, never guessed.
//   PENDING        a mark that already carries an unruled adoption claim (the
//                  ceremony filed one and no crossing has ruled it). The crossing
//                  will; a second claim would only race it.
//
// ── THE GRANDFATHER (the ruling's words) ────────────────────────────────────
//
// "grandfather over-cap houses": a house whose adopted parcel count would
// exceed the cap is adopted ANYWAY and LISTED as over-cap. No withdrawal, no
// refusal. The cap applies to NEW parcels only from then on — and it does so by
// the gate that already exists: once the count counts these rows (below), the
// clearing's step 5.6 refuses a new parcel to a house already at or over the
// cap with the sentence it already speaks (`parcel-cap.mjs § parcelCapCheck`).

import { loadRegistryRows } from "./registry-store.mjs";
import { registryFromRows, pinsFromRows } from "./registry-rows.mjs";
import { resolveHouse, houseKeysOf, keyOfSlug } from "./household-deriver.mjs";
import { actsQuery } from "./world2-acts.mjs";

/** The acts grammar. `class` is the registry's own noun; see the PR body for the wording. */
export const ADOPT_CLASS = "household";
/** One act per house that adopts — at the ceremony, and one receipt per house from the batch. */
export const ADOPT_ACTION = "adopt";
/**
 * The store fact the count flips on. Written ONCE, by the batch, after every
 * house committed. It is an ACT because acts are append-only: the count can
 * only flip where the batch has actually run, and nothing can flip it back.
 */
export const COUNTED_ACTION = "solo-counted";

/** The key an adoption stamps into the claim's (and so the mark's) `data`. Underscored: a store stamp, never a record field. */
export const ADOPTED_KEY = "_adopted";

export const isSolo = (k) => typeof k === "string" && k.startsWith("solo:");

/** The ceremony's sentence — the act's `effect`, composed in one place. */
export const adoptionEffect = (slug, n, from) =>
  `the house ${slug} adopts ${n} mark${n === 1 ? "" : "s"} placed before it had a key — ` +
  `${from.join(", ")} ${from.length === 1 ? "becomes" : "become"} ${keyOfSlug(slug)}; ` +
  "every byte of each mark is unchanged, and the old spelling stays in the house's set";

// ── which house holds a `solo:` spelling ─────────────────────────────────────

/**
 * Map `solo:<x>` → the ONE house whose spelling set holds it. PURE.
 *
 * Built by inverting `houseKeysOf` over every house, so it is the SAME set
 * #166's draft policy reads — one definition of "this spelling is that house's"
 * for reads, adoption and (after the batch) the count. A spelling two houses
 * hold maps to an array of both, which every caller treats as a refusal.
 */
export function soloHouseIndex(registry, pins = {}) {
  const idx = new Map();
  for (const slug of Object.keys(registry?.households ?? {})) {
    for (const k of houseKeysOf(keyOfSlug(slug), registry, pins)) {
      if (!isSolo(k)) continue;
      const was = idx.get(k);
      if (was === undefined) idx.set(k, slug);
      else if (was !== slug) idx.set(k, [...new Set([].concat(was, slug))]);
    }
  }
  return idx;
}

/** The house a `solo:` spelling belongs to, or null (none, or more than one). */
export const soloHouseOf = (idx, k) => {
  const v = idx.get(k);
  return typeof v === "string" ? v : null;
};

// ── THE PLAN — one function, both arms ───────────────────────────────────────

/**
 * What adoption would do to this store. PURE.
 *
 * @param {object}   o
 * @param {object[]} o.marks     standing `marks` rows: `{ id, slug, kind, owner, household }` at least
 * @param {object}   o.registry  the folded registry (`registryFromRows`)
 * @param {object}   o.pins      the folded pins
 * @param {Set}      [o.pending] mark ids that already carry an unruled adoption claim
 * @param {string}   [o.only]    adopt into this one house (the ceremony); default every house (the batch)
 * @param {number}   [o.cap]     the parcel cap, read from the world (`parcelCapLawAt`); null = not judged
 */
export function planAdoption({ marks = [], registry, pins = {}, pending = new Set(), only = null, cap = null } = {}) {
  const idx = soloHouseIndex(registry, pins);
  const standing = marks.filter((m) => (m.status ?? "standing") === "standing");
  const houses = new Map();
  const orphans = [], held = [], waiting = [], stops = [];

  // The parcels each house ALREADY holds under a spelling the deriver walks
  // (`hh:`, `gh:`, a former slug) — the count the cap sees today.
  const heldParcels = new Map();
  for (const m of standing) {
    if (m.kind !== "parcel" || isSolo(m.household)) continue;
    const s = resolveHouse(m.household, registry, pins).slug;
    if (s) heldParcels.set(s, (heldParcels.get(s) ?? 0) + 1);
  }

  for (const m of standing) {
    if (!isSolo(m.household)) continue;
    const v = idx.get(m.household);
    if (Array.isArray(v)) {
      stops.push(`${m.slug}: ${m.household} is held by ${v.length} houses (${v.join(", ")}) — a spelling with two houses is a cross-household read, and adoption will not choose`);
      continue;
    }
    if (!v) { orphans.push({ slug: m.slug, from: m.household, why: "no house on the roll holds this spelling — left standing as it is, for a person" }); continue; }
    if (only && v !== only) continue;
    const ownerHouse = resolveHouse(m.owner, registry, pins).slug;
    if (ownerHouse !== v) {
      held.push({ slug: m.slug, from: m.household, house: v,
        why: `its owner ${JSON.stringify(m.owner)} stands in ${ownerHouse ?? "no house"}, and the pen grains a mark by its owner — adopting it would file it there, not in ${v}` });
      continue;
    }
    if (pending.has(String(m.id))) { waiting.push({ slug: m.slug, from: m.household, house: v }); continue; }
    if (!houses.has(v)) houses.set(v, []);
    houses.get(v).push(m);
  }

  const out = [];
  for (const [slug, ms] of [...houses.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    ms.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
    const adopted = ms.filter((m) => m.kind === "parcel").length;
    const already = heldParcels.get(slug) ?? 0;
    const total = already + adopted;
    out.push({
      slug, key: keyOfSlug(slug),
      from: [...new Set(ms.map((m) => m.household))].sort(),
      marks: ms,
      parcels: { held: already, adopted, total },
      overCap: cap != null && total > cap,
      atCap: cap != null && total === cap,
    });
  }
  return { houses: out, orphans, held, pending: waiting, stops, cap };
}

/** The dry-run's and the receipt's text. */
export function renderAdoption(plan, { header = "solo adoption" } = {}) {
  const NL = String.fromCharCode(10);
  const lines = [];
  const n = plan.houses.reduce((s, h) => s + h.marks.length, 0);
  lines.push(`${header} · ${plan.houses.length} house(s) adopt ${n} mark(s) · cap ${plan.cap ?? "not judged"}`);
  for (const h of plan.houses) {
    const flag = h.overCap ? "  OVER CAP (grandfathered — adopted anyway; the cap binds NEW parcels only)"
      : h.atCap ? "  at cap" : "";
    lines.push(`  ${h.key}  ← ${h.from.join(", ")}  · ${h.marks.length} mark(s), parcels ${h.parcels.held} held + ${h.parcels.adopted} adopted = ${h.parcels.total}${flag}`);
    for (const m of h.marks) lines.push(`      ~ ${m.slug}  [${m.kind}]`);
  }
  const over = plan.houses.filter((h) => h.overCap);
  lines.push(`OVER CAP ${over.length}${over.length ? `: ${over.map((h) => `${h.key} (${h.parcels.total})`).join(", ")}` : ""}`);
  if (plan.pending.length) {
    lines.push(`PENDING AT THE CROSSING ${plan.pending.length} (the ceremony filed them; the next crossing rules them):`);
    for (const p of plan.pending) lines.push(`  · ${p.slug}  ${p.from} → hh:${p.house}`);
  }
  if (plan.held.length) {
    lines.push(`HELD ${plan.held.length} (a person's call; nothing written):`);
    for (const h of plan.held) lines.push(`  · ${h.slug}  ${h.from} — ${h.why}`);
  }
  if (plan.orphans.length) {
    lines.push(`ORPHANED ${plan.orphans.length} (no house holds the spelling; nothing written):`);
    for (const o of plan.orphans) lines.push(`  · ${o.slug}  ${o.from}`);
  }
  if (plan.stops.length) {
    lines.push(`STOP ${plan.stops.length} — the run refuses whole:`);
    for (const s of plan.stops) lines.push(`  ! ${s}`);
  }
  return lines.join(NL);
}

// ── the store's side, shared by both arms ────────────────────────────────────

export const SOLO_MARKS_SQL = `
  SELECT id::text AS id, slug, kind, owner, household, body, geometry, bbox,
         parent::text AS parent, data, status
    FROM marks
   WHERE status = 'standing' AND household LIKE 'solo:%'
   ORDER BY slug`;

/** Every standing parcel's spelling — what `planAdoption` needs to count a house's holdings. */
export const PARCEL_SPELLINGS_SQL = `
  SELECT id::text AS id, slug, kind, owner, household, status
    FROM marks
   WHERE status = 'standing' AND kind = 'parcel' AND household NOT LIKE 'solo:%'`;

/** Marks already carrying an unruled adoption claim. */
export const PENDING_ADOPTIONS_SQL = `
  SELECT supersedes::text AS id FROM claims
   WHERE status = 'pending' AND supersedes IS NOT NULL AND data ? '${ADOPTED_KEY}'`;

export const COUNTED_SQL = `SELECT 1 AS counted FROM acts WHERE class = '${ADOPT_CLASS}' AND action = '${COUNTED_ACTION}' LIMIT 1`;

/** Has the batch run on this store? The one fact the count flips on. */
export async function soloCountedAt(q) {
  const r = await q(COUNTED_SQL);
  return !!(r?.rows ?? r)?.length;
}

// ── THE CEREMONY'S ARM ───────────────────────────────────────────────────────

/**
 * The door's adoption: ONE statement, so the act and its claims commit or
 * vanish together on a pool that holds no transaction of its own (the same
 * reason `world2-claims.mjs § claimTxFromJournal` rides one client).
 *
 * Every column of the claim is read off the standing mark IN THE STATEMENT, so
 * nothing the resident authored passes through this process and nothing can be
 * re-typed on the way. `household` is the house's key (`claims.household` is
 * the acting scope, and this act is the house's); `marks.household` is NOT
 * written here — the clearing's `materializeClaims` re-derives it from the
 * owner when it rules the claim.
 *
 * The WHERE clause re-checks what the plan decided (still standing, still the
 * `solo:` spelling it was, no adoption already pending) so a row that moved
 * between the read and this write is simply not adopted.
 */
export const CEREMONY_ADOPT_SQL = `
  WITH open_window AS (
    SELECT id FROM windows WHERE status = 'open' ORDER BY id DESC LIMIT 1
  ), eligible AS (
    SELECT m.* FROM marks m
     WHERE m.id = ANY($5::uuid[])
       AND m.status = 'standing'
       AND m.household LIKE 'solo:%'
       AND NOT EXISTS (SELECT 1 FROM claims p
                        WHERE p.status = 'pending' AND p.supersedes = m.id AND p.data ? '${ADOPTED_KEY}')
  ), adopt_act AS (
    INSERT INTO acts (at, crossing, actor, action, object, class, payload, effect, household)
    SELECT now(), NULL, $1, '${ADOPT_ACTION}', $2, '${ADOPT_CLASS}', $3::jsonb, $4, $2
     WHERE EXISTS (SELECT 1 FROM open_window) AND EXISTS (SELECT 1 FROM eligible)
    RETURNING id
  )
  INSERT INTO claims (window_id, class, claimant, household, body, geometry, bbox, stake,
                      supersedes, parent, data, slug, status)
  SELECT w.id, m.kind, m.owner, $2, m.body, m.geometry, m.bbox, 0,
         m.id, m.parent,
         COALESCE(m.data, '{}'::jsonb)
           || jsonb_build_object('${ADOPTED_KEY}', jsonb_build_object('from', m.household, 'to', $2::text, 'at', 'ceremony'),
                                 '_act_id', a.id::text),
         m.slug, 'pending'
    FROM eligible m, open_window w, adopt_act a
  RETURNING id::text AS id, slug`;

/**
 * Adopt, at the ceremony, every `solo:` mark this house's people hold.
 *
 * Called by `ceremony.mjs` after a house is minted or a resident joins it, when
 * the registry already holds the new row. Returns an outcome; it THROWS only on
 * a store error, and the ceremony catches that (the house IS founded — see
 * `ceremony.mjs § adoptionOutcome`).
 *
 * `query` is `actsQuery`'s shape: `(text, params) => rows | null`. `null` means
 * the office is not pointed at the record, and nothing is adopted.
 */
export async function adoptAtCeremony({ slug, actor = null, env = process.env, query = actsQuery } = {}) {
  const key = String(slug ?? "").trim().toLowerCase();
  if (!key) return { filed: 0, skipped: "no house named" };
  const rows = await loadRegistryRows(env);
  if (rows === null) return { filed: 0, skipped: "the office is not pointed at the record" };
  const registry = registryFromRows(rows);
  const pins = pinsFromRows(rows);
  if (!registry.households?.[key]) return { filed: 0, skipped: `no house ${key} on the roll` };

  const q = (text, params = []) => query(text, params, env);
  const solo = await q(SOLO_MARKS_SQL);
  if (solo === null) return { filed: 0, skipped: "the office is not pointed at the record" };
  if (!solo.length) return { filed: 0 };
  const parcels = (await q(PARCEL_SPELLINGS_SQL)) ?? [];
  const pending = new Set(((await q(PENDING_ADOPTIONS_SQL)) ?? []).map((r) => String(r.id)));

  const plan = planAdoption({ marks: [...solo, ...parcels], registry, pins, pending, only: key });
  if (plan.stops.length) return { filed: 0, refused: plan.stops };
  const house = plan.houses[0];
  if (!house) return { filed: 0, held: plan.held, pending: plan.pending };

  const payload = {
    house: house.key, from: house.from, marks: house.marks.map((m) => m.slug),
    parcels: house.parcels, rules_at: "the next crossing",
  };
  const filed = await q(CEREMONY_ADOPT_SQL, [
    actor ?? key, house.key, JSON.stringify(payload),
    adoptionEffect(key, house.marks.length, house.from),
    house.marks.map((m) => String(m.id)),
  ]);
  if (filed === null) return { filed: 0, skipped: "the office is not pointed at the record" };
  if (!filed.length) return { filed: 0, skipped: "no open window — the candle is dark, and an adoption is ruled at a crossing" };
  return { filed: filed.length, house: house.key, from: house.from, marks: filed.map((r) => r.slug), held: plan.held };
}
