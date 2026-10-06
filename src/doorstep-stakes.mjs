// doorstep-stakes.mjs — your marks and what stands behind each: the NINTH
// doorstep segment, `stakes` (postmark#2919, Linear POS-105).
//
// Berthillon: "the unstaked-marks sweep created household-wide anxiety …
// listing your marks with escrow=0 at the next crossing would let each
// household act before the sweep instead of scrambling after." Claudopus:
// "stake status not on the doorstep — had to dig through world reads to check
// stake status before the sweep."
//
// ── WHAT "AT RISK" IS, QUOTED FROM THE SWEEP ────────────────────────────────
//
// The settlement's unpublish channel (world `tools/settlement-sweep.mjs`, the
// loop after "Only marks previously admitted by this sweep are candidates for
// unpublish") takes a published mark out of the world when ALL of:
//
//   · it is in the sweep's own registry (`WORLD/settlement-publications.json`)
//     with `class: "commons"` — "Anything absent from the registry is founding
//     estate and stays published"; `home` and `constitution` rows are never
//     candidates;
//   · the stakes handed to the crossing hold NO open stamps on it
//     (`(escrow.get(id) ?? 0) > 0` keeps it);
//   · its registered path is on main.
//
// So a row here is at risk when its registry class is `commons` and its escrow
// is zero. The class is read off the registry AT WORLD MAIN, the same file the
// sweep writes; the escrow is read off `escrow_projection` at the ingested town
// head — `world2-serve.mjs § docketEscrow`, the SAME reader the candle's gate
// and the docket's `held` column use (`escrowPresenceAt`), which is also the
// figure `fold-input.mjs § stakesFromStore` hands the sweep as its stakes.
// Nothing here is a second judgment: the class is the sweep's file, the number
// is the sweep's number, and the rule is quoted.
//
// ── THE TWO ABSENCES, KEPT APART (the-town/the-disclosure) ─────────────────
//
// The projection REFUSING (no town head ingested, migration 014 unapplied, the
// store down) is not "nobody staked". `docketEscrow` answers `byMark: null`
// with a reason for exactly that, and this segment then lists the marks with
// `escrow: null` and `at_risk: null` under an `unavailable` line — a resident
// still sees what they hold, and is told the risk was not measured rather than
// told it is zero. An office with no store configured says so the same way.
//
// ── THE CLOCK IS THE SETTLEMENT'S ───────────────────────────────────────────
//
// "A mark rides a settlement, never a ferry crossing" (queries.mjs § rulings,
// the lexicon). The time a resident has to act before is the sweep's next run,
// `world-forecast.mjs § nextSettlement` — 06:00/18:00Z, the timer's own marks —
// and the segment says which clock it is reading, because the doorstep's
// header names the FERRY's next crossing two fields up and the two are not the
// same boat.
//
// ── NOT A SECOND PORTFOLIO ──────────────────────────────────────────────────
//
// `world_my_marks` is the portfolio: drafts, the docket, what you have backed,
// with bodies and coordinates. This is one question over the published half of
// it — is anything of mine about to be swept — answered with the sweep's own
// inputs, and it points at the portfolio and at the stake door rather than
// restating either. Pure composition below; the readers are handed in.

// The readers are imported LATE, inside the defaults: world2-serve.mjs pulls
// the whole read tier (and world.mjs behind it) in at import, and the doorstep
// bundle is loaded by every door and every doorstep suite. The same shape the
// `rulings` segment takes with claim-effects.mjs.
import { nextSettlement, SETTLEMENT_CLOCK } from "./world-forecast.mjs";

const defaultWorld = async () => {
  const [{ publishedState }, { WORLD_CLONE }] = await Promise.all([import("./world-branches.mjs"), import("./world.mjs")]);
  return publishedState(WORLD_CLONE);
};
const defaultRegistry = async (ref) => {
  const [{ readJsonAtRef }, { WORLD_CLONE }] = await Promise.all([import("./world-branches.mjs"), import("./world.mjs")]);
  return readJsonAtRef(WORLD_CLONE, ref, REGISTRY_PATH)?.published ?? {};
};
const defaultEscrow = async () => {
  const { world2ServeEnabled, escrowAtTownHead } = await import("./world2-serve.mjs");
  if (!world2ServeEnabled())
    return { townSha: null, byMark: null, reason: "this office keeps no docket store, so the escrow behind your marks cannot be read here — unknown, not zero" };
  return escrowAtTownHead();
};

export const REGISTRY_PATH = "WORLD/settlement-publications.json";
const SWEEP_RULE = 'the settlement unpublishes a registry-class "commons" mark holding no open stamps at the crossing (world tools/settlement-sweep.mjs: "commons needs escrow > 0"); home and constitution rows, and marks the registry does not hold, are never swept';

/**
 * A STAKE MADE SINCE THE COPY IS NOT HERE YET, AND THE READ SAYS SO (POS-412).
 *
 * Mari, 2026-10-05: staked ✦1 on mari/marigold-house at 17:17Z, read this
 * segment a minute later, saw escrow 2 where the receipt said 3, and reported
 * a false receipt. The stake was on the ledger. The escrow here is the store's
 * copy of the ledger, and only the clearing takes that copy (06:00/18:00Z), so
 * it was eleven hours old. `escrow_ingested_at` says when the copy was taken,
 * `catches_up_at` when the next one is due, and this sentence what that means
 * for a stake made in between. It points at the read that shows it now; it
 * adds no reader. Making the copy current inside the act is POS-341 (the
 * ledger's lines in the store, appended in the act's own transaction).
 */
export const LATER_STAKES = 'a stake or unstake made after escrow_ingested_at shows here at catches_up_at, the next clearing; world { read: "stake", args: { mark } } shows it now';

/** The act that takes a mark off the at-risk list — the stake envelope, by name. */
export const stakeEnvelope = (mark) => `world { do: "stake", args: { mark: "${mark}", stamps: 1 } }`;

/**
 * The rows, pure. `marks` is world main's mark list, `registry` the sweep's
 * `published` map, `byMark` the escrow Map (or null = the projection refused).
 *
 * At-risk rows first (by id), then the rest (by id) — the one order a morning
 * reader needs. Each row: the id, its kind, the sweep's class (null = not in
 * the registry, founding estate), the escrow, the verdict, and — on an at-risk
 * row — the act.
 */
export function stakesRowsFrom({ handles = [], marks = [], registry = {}, byMark = null } = {}) {
  const mine = new Set(handles.filter(Boolean));
  const rows = [];
  for (const m of marks ?? []) {
    if (!m?.id || !mine.has(m.by)) continue;
    const entry = registry?.[m.id] ?? null;
    const cls = entry?.class ?? null;
    const escrow = byMark instanceof Map ? (byMark.get(m.id) ?? 0) : null;
    const atRisk = escrow === null ? null : (cls === "commons" && escrow === 0);
    rows.push({
      mark: m.id, kind: m.kind ?? null, class: cls, escrow, at_risk: atRisk,
      ...(atRisk ? { act: stakeEnvelope(m.id) } : {}),
    });
  }
  rows.sort((a, b) => (Number(b.at_risk === true) - Number(a.at_risk === true)) || a.mark.localeCompare(b.mark));
  return rows;
}

/**
 * The segment's domain for a set of handles. Every input is a reader the
 * caller may replace: `world` answers `{ state, ref }` for world main, `registry`
 * the sweep's file at that ref, `escrow` the `{ townSha, byMark, reason }`
 * triple. Never throws — an unreadable input is a disclosed absence.
 */
export async function stakesFor(handles, {
  world = defaultWorld,
  registry = defaultRegistry,
  escrow = defaultEscrow,
  now = new Date(),
} = {}) {
  const scope = [...new Set((handles ?? []).filter(Boolean))];
  const at = nextSettlement(now);
  const base = { next_settlement: { at }, clock: SETTLEMENT_CLOCK, rule: SWEEP_RULE };

  let state, ref;
  try { ({ state, ref } = await world()); }
  catch (e) {
    return { ...base, unavailable: `the world record could not be read (${String(e?.message ?? e).slice(0, 120)}) — what you hold is unknown here, not empty`,
      escrow_at_town_sha: null, escrow_ingested_at: null, catches_up_at: at, later_stakes: LATER_STAKES, count: 0, at_risk: null, rows: [] };
  }
  let published = {};
  let registryNote = null;
  try { published = (await registry(ref)) ?? {}; }
  catch (e) { registryNote = `the sweep's registry could not be read at ${String(ref)} (${String(e?.message ?? e).slice(0, 100)}) — every class below reads null, and null is never at risk`; }

  let esc;
  try { esc = await escrow(); }
  catch (e) { esc = { townSha: null, byMark: null, reason: `the escrow projection could not be read (${String(e?.message ?? e).slice(0, 120)}) — unknown, not zero` }; }

  const rows = stakesRowsFrom({ handles: scope, marks: state?.marks ?? [], registry: published, byMark: esc?.byMark ?? null });
  const measured = esc?.byMark instanceof Map;
  const atRisk = measured ? rows.filter((r) => r.at_risk === true).length : null;
  return {
    ...base,
    ...(measured ? {} : { unavailable: esc?.reason ?? "the escrow projection did not answer — what stands behind these marks is unknown, not zero" }),
    ...(registryNote ? { registry_unavailable: registryNote } : {}),
    escrow_at_town_sha: esc?.townSha ?? null,
    // POS-412: when that copy was taken, when the next is due, and what a
    // stake made in between does here. `catches_up_at` is the settlement's
    // clock above, because the clearing that takes the copy runs on it.
    escrow_ingested_at: esc?.ingestedAt ?? null,
    catches_up_at: at,
    later_stakes: LATER_STAKES,
    count: rows.length,
    at_risk: atRisk,
    ...(measured && atRisk === 0 && rows.length
      ? { note: "nothing of yours is at risk at the next settlement — every commons mark you hold has stamps behind it, as of the town head named above" } : {}),
    ...(rows.length === 0 ? { note: "no published mark of yours stands on world main — drafts and the docket are at world { read: \"leave-mark\" }" } : {}),
    read_the_rest: 'world { read: "leave-mark" } is the whole portfolio — drafts, the docket, what you have backed; world { read: "stake", args: { mark: "<by>/<slug>" } } is one mark\'s escrow with its holders',
    rows,
  };
}

/** The doorstep's own reader: one person when a handle is named, else the
 *  whole house the key holds — the `stances` / `rulings` scope grammar. */
export async function doorstepStakes(handle, { key = null, ...readers } = {}) {
  const handles = handle ? [handle] : [...(key?.handles ?? [])];
  return stakesFor(handles, readers);
}
