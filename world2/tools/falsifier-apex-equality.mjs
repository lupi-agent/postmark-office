#!/usr/bin/env node
// falsifier-apex-equality.mjs — the guard on the APEX door's port.
//
// `/world2/apex` answers the orientation question out of Postgres:
// `law_projection` for the affordances, `marks` + the skeleton rows for the
// world the engine judges. The runbook's GO for B2 is one sentence:
//
//   "a /world2/apex answer at a given standpoint is field-for-field equal to
//    GET /world/apex at the same standpoint, across a sampled set of
//    standpoints, with granted/actions/terms composed from law_projection at
//    the window's pinned law_sha; an equality falsifier carrying the same
//    --prove-can-fail shape as its five siblings."
//
// This is that falsifier, and it is the live lane's design one door over:
//
//   RUN BOTH, OVER THE SAME STATE, AND NAME EVERY FIELD THEY DISAGREE ABOUT.
//
// Every oracle below is 1.0's OWN function, imported live — `worldApex`,
// `gatherActions`, `gatherGroundActions`, `residueOf`, `buildTerms`. Nothing
// here re-expresses what it is judging. Where the two sides share a function on
// purpose (`buildTerms`, `resolveGrants`, `fieldsFor`) the equality is about the
// DATA those functions were handed, which is the only thing this lane changed.
//
// ── THE EQUALITIES, AND WHAT EACH ONE COULD CATCH ───────────────────────────
//
//   A1 GRANTED        1.0's `granted` block against the port's, per standpoint.
//                     Catches: a class the projection's gate admits and the
//                     store's does not (or the reverse), a lost `ambient:`, a
//                     ground channel that resolved to a different class.
//   A2 ACTIONS        the whole card set, per standpoint, field by field:
//                     action · via · channel · from · class · grant · blurb ·
//                     blurb_from · dials · fields · dispatches_to. Catches: a
//                     blurb quoted from the wrong residue, a dropped `fields`
//                     grammar, the ground/ambient precedence resolving the
//                     other way, a `for: human` grant married to the resident
//                     declaration by a name-join.
//   A3 WITHIN         the containment spine, id-for-id AND field-for-field.
//                     Catches: a mark record assembled with the wrong
//                     `at`/`extent`/`points`, a lost `points:` ring (which
//                     silently falls back to the bbox), a `by`/`tier` swap.
//   A4 NEARBY         the field of view: the id SET and the ORDER. Order is
//                     load-bearing — it is the salience ranking, and `lodScore`
//                     reads `mark.weight`, which 2.0's store cannot supply.
//                     This equality is the instrument that MEASURES that gap
//                     rather than a comment asserting it.
//   A5 TERMS          seam 2's block, built by 1.0's own `buildTerms` from BOTH
//                     sides' law, for every action at every standpoint. This is
//                     the runbook's NO-GO made checkable: "terms composed from
//                     anything but law_projection would rebuild the S39 class
//                     the projection exists to make catchable."
//   A6 PRESENT        the roll near the point — the live port, in the apex's
//                     own render.
//   A7 THE KEY SET    every top-level key one answer carries and the other does
//                     not. The equality nobody writes, and the one that catches
//                     a field quietly going missing rather than going wrong.
//   A8 RECORDS        the `records` block (#2896): the id SET both answers name
//                     — the spine, the field of view, the town's ground, the
//                     mover's class — and every published field of every
//                     record, id by id. A7 catches the block going missing;
//                     this catches a record inside it going missing or going
//                     wrong: a `parent` read off the directory instead of the
//                     authored line, a `tier` the store has not recomputed, a
//                     `declared_household` the clearing wrote from a stale
//                     roster. The seven fields no row holds are acknowledged
//                     BY NAME (AD-5, AD-6) and absent, never zero.
//
// ── EXIT CODES ──────────────────────────────────────────────────────────────
//
//   0  every equality holds
//   1  RED — a divergence, named, with the 1.0 line that produces it
//   2  CANNOT RUN
//
// There is no code for "checked nothing and found nothing". A sample that could
// not be built, a standpoint class the store does not hold, or an equality that
// ended up comparing zero rows all exit 2, loudly. Each equality reports its own
// `compared`.
//
// ── DIVERGENCES THAT ARE EXPECTED, AND WHY THAT IS NOT A LOOPHOLE ───────────
//
// Some fields cannot agree yet and the reason is structural, not a bug in the
// port — `mark.weight` has no escrow view to come from (P-006, ruled and
// unbuilt), and the frame fold is refused by the live port. A falsifier that
// simply ignored them would be a green that means nothing.
//
// So they are ACKNOWLEDGED, not exempted: each one is declared below with the
// 1.0 line that produces it, it is reported in full every run with its measured
// size, and `--strict` turns every one of them back into a RED. The default run
// is AMBER on an acknowledged divergence — exit 0 with the divergence printed —
// and RED on any other. An acknowledged divergence that STOPS happening is also
// reported, because a guard nobody can see going stale is the staleness class
// this whole lane exists to kill.
//
// ── RUNNING IT ──────────────────────────────────────────────────────────────
//
//   export WORLD2_PG_URL="postgres://snapshot_reader:…@localhost:5432/world2_dev"
//   export WORLD_CLONE=/srv/world2-lab/world-frozen
//   export WORLD_STORE_DB=/srv/world2-lab/office/world.db
//   export WORLD_APEX=1
//   node world2/tools/falsifier-apex-equality.mjs \
//     --world-repo /srv/world2-lab/world-frozen --law-sha <the seed's sha> --prove-can-fail
//
// `--law-sha` PINS BOTH SIDES to one law. Without it the port reads the window
// pin and the oracle reads whatever its sqlite store was hydrated from, and a
// disagreement would be about two different laws rather than about this port.
// `--json` machine-readable · `--strict` acknowledged divergences count as RED
// · `--prove-can-fail` breaks each equality on purpose and requires every break
// to turn this red (`--can-fail-proof` is accepted as its sibling spelling).

import { existsSync } from "node:fs";
import { resolve } from "node:path";

const arg = (n) => { const i = process.argv.indexOf(n); return i === -1 ? null : process.argv[i + 1]; };
const has = (n) => process.argv.includes(n);
const die = (msg) => { console.error(`CANNOT RUN · ${msg}`); process.exit(2); };

const JSON_OUT = has("--json");
const STRICT = has("--strict");
const PROVE = has("--prove-can-fail") || has("--can-fail-proof");

const worldRepo = arg("--world-repo");
if (!worldRepo) die("usage: falsifier-apex-equality.mjs --world-repo <checkout> [--law-sha <sha>] [--json] [--strict] [--prove-can-fail]");
const REPO = resolve(worldRepo);
if (!existsSync(REPO)) die(`no checkout at ${REPO}`);
if (!process.env.WORLD2_PG_URL) die("WORLD2_PG_URL missing");
// The oracle reads the clone; the port's engine loader reads the same one.
process.env.WORLD_CLONE ??= REPO;
// The 1.0 apex gates itself behind its own flag, and a falsifier that silently
// ran against a disabled door would compare a bounce to an answer and call it a
// divergence. Set it here, loudly, rather than requiring the caller to know.
if (process.env.WORLD_APEX !== "1") process.env.WORLD_APEX = "1";
// And the presence flag, for the same reason: without it 1.0 composes no `present` block at all,
// A6 compares 0 handles, and the run ends CANNOT RUN — twice on 2026-09-04 before this line.
// A falsifier that needs a flag sets the flag; a recipe in a report is not a guard.
if (process.env.WORLD_PRESENCE !== "1") process.env.WORLD_PRESENCE = "1";

// ── the oracles, imported live out of this office ───────────────────────────
let apexMod, grantsMod, serveMod, portMod, pg;
try {
  apexMod = await import("../../src/world-apex.mjs");
  grantsMod = await import("../../src/world-grants.mjs");
  serveMod = await import("../../src/world2-serve.mjs");
  portMod = await import("./apex-reads.mjs");
  ({ default: pg } = await import("pg"));
} catch (e) { die(`this office's own modules cannot be imported: ${e.message}`); }

const { worldApex, gatherActions, gatherGroundActions, residueOf, buildTerms, openStore } = apexMod;
const { resolveGrants } = grantsMod;
const { world2Apex } = serveMod;
if (typeof world2Apex !== "function") die("src/world2-serve.mjs exports no world2Apex — this falsifier has nothing to hold to 1.0");

const pool = new pg.Pool({ connectionString: process.env.WORLD2_PG_URL, max: 3 });

// ── the acknowledged divergences ────────────────────────────────────────────
//
// Declared as DATA so the report can print them, so `--strict` can promote
// them, and so a reader can see the whole list without reading the comparator.
// Each names the 1.0 line that produces it — the report's own requirement.
const ACKNOWLEDGED = Object.freeze([
  { id: "AD-1", field: "nearby[].members / nearby[].members[] / nearby[].order / nearby[].order[] / records.ids / records.ids[]",
    because: "world-engine.mjs § lodScore: `const stamp = 1 + dials.weight_lod_k * Math.log1p(Math.max(0, weight))` — the FOV ranks by angular size MODULATED BY STAMPS, and 2.0's stamp_projection holds per-handle balances, not per-mark escrow. The port emits weight: 0 on every mark (apex-reads.mjs § markRecordOf), so ranking is unweighted and the budget cap can admit a different tail. `records` is keyed by exactly the ids `nearby` names (plus the ground and the mover's class, which both sides select identically), so its id set carries the same tail — measured 2026-09-17 on prod: every id in one block and not the other was in that side's own `nearby`, at all fourteen standpoints.",
    closes_with: "parity P-006's escrow view over stamp_projection (RULED, unbuilt) — then weight is a query and this row dies." },
  { id: "AD-2", field: "present.residents[].standing / present.residents[].aboard",
    because: "live-reads.mjs § What is NOT here: the FRAME half is refused. dynamic-presence.mjs's readPresence composes `standing` and `aboard` from positions.mjs § withFrames, which needs the vessel's frame fold. The port omits both rather than emitting false.",
    closes_with: "the frame fold ported over acts (D-series), or the vessel's carriage becoming a view." },
  { id: "AD-4", field: "present.count / present.shown / present.capped / present.residents[].members",
    because: "the two stores hold different amounts of the same record. The oracle's clone runs under LEDGER_FREEZE at sandbox/seed (world.mjs § departuresAcrossEras reads the frozen ledger plus the journal); world2_dev's `acts` has kept taking the live mirror since the seed. Measured 2026-09-03: 1774 departure acts over 80 handles in Postgres against 317 over 50 in the 1.0 store, PG a strict superset (0 handles 1.0 has that PG lacks). A6 therefore compares the RENDER over the shared handles and reports the scope; the aggregates cannot agree and their disagreement says nothing about this port.",
    closes_with: "an A/B pair seeded at the same instant — the frozen sandbox/seed office beside a Postgres restored from the same tag — or a --since bound on both sides. Not closeable by editing this door." },
  { id: "AD-3", field: "law.hydrated_at / law.as_of_world / law.source",
    because: "world-apex.mjs:  `law: { as_of_world: store.meta?.as_of_world, hydrated_at: store.meta?.hydrated_at, source: \"world.db\" }` — 1.0 names the bake. There is no bake in this tier; the block names the law PIN instead. A divergence by design, and the one field where equality would be the defect.",
    closes_with: "nothing — this is the cutover difference, and G2's read-path deletion is where 1.0's spelling goes." },
  { id: "AD-5", field: "records[].stamps / records[].weight / records[].weight_parts / records[].ledger_weight",
    because: "marks-fold.mjs § the published mark: `stamps: stakeByMark.get(mk.id) ?? 0, weight: weight.get(mk.id) ?? 0, ...partsField(mk.id)` and `...ledgerWeightField(mk.id)` — the town's stamp ledger folded, with breadth and fan-up. No row holds them (AD-1's hole, seen from the record's side), and `records` leaves them ABSENT rather than emitting a 0 that would read as a resident's ✦ figure (apex-reads.mjs § RECORD_FIELDS_NOT_ANSWERED). Reported as `(absent)` on the 2.0 side of every mark that carries one.",
    closes_with: "parity P-006's escrow view over stamp_projection (RULED, unbuilt) and a stamp-ingest on a cadence — then stamps and ledger_weight are a query, and weight/weight_parts a fold over it." },
  { id: "AD-6", field: "records[].sovereign / records[].placementParent / records[].kept",
    because: "marks-fold.mjs § the published mark: `sovereign: !!mk._sovereign`, `placementParent: containedBy.get(mk.id)`, `kept: consent.kept.has(mk.id)` — three receipts of the standing walk, derived on the way to `tier`. materialize.mjs § recomputeStanding writes back `tier` alone, so no row carries them; `records` leaves them absent rather than re-walking the world inside a read.",
    closes_with: "the standing flip (DESIGN-standing-flip.md) writing the walk's whole answer to the row — then all three are columns." },
]);
// ⚠ EXACT, NEVER PREFIX. The first cut matched a divergence to an
// acknowledgement by prefix, and it immediately swallowed four real ones:
// `present.residents[postmaster].source` (1.0 `parcel`, 2.0 `walk`) was filed
// under AD-2's `present.residents[].standing` because both start with
// `present.residents`. An acknowledgement that absorbs neighbours is worse than
// no acknowledgement — it is a red wearing an amber coat. So a path is
// normalised (every index to `[]`) and must equal one of the declared fields
// outright.
const ACK_FIELDS = new Map(ACKNOWLEDGED.flatMap((a) => a.field.split(" / ").map((f) => [f.trim().replace(/^\./, ""), a])));
const ackFor = (path) => {
  const norm = String(path).replace(/\[[^\]]*\]/g, "[]").replace(/^\./, "").replace(/\.length$/, "");
  return ACK_FIELDS.get(norm) ?? null;
};

// ── the sample ──────────────────────────────────────────────────────────────
//
// DERIVED FROM THE STORE, NEVER TYPED IN. A hardcoded coordinate list is a
// fixture that rots the first time a mark relocates, and it would silently stop
// testing the class it was chosen for while still reporting twelve greens. Each
// standpoint below is a REQUIREMENT with a finder; a requirement that finds
// nothing REFUSES (exit 2) rather than shrinking the sample quietly.
//
// The runbook names five classes explicitly — "a berth, a human lane, a
// standpoint inside a building, one on the commons, one on the vessel if it
// exists" — and each appears here under its own id, so the report can say which
// class a divergence lives in rather than only which coordinate.
const centreOf = (m) => (m?.geometry?.at?.x != null ? { x: Number(m.geometry.at.x), y: Number(m.geometry.at.y) } : null);

async function buildSample() {
  const { rows: marks } = await pool.query(
    "SELECT slug, kind, owner, household, geometry, data FROM marks WHERE status = 'standing' AND geometry IS NOT NULL ORDER BY slug");
  const bySlug = new Map(marks.map((m) => [m.slug, m]));
  const want = [];
  const missing = [];
  const notes = [];
  const need = (id, why, m) => {
    const at = centreOf(m);
    if (!at) { missing.push(`${id} (${why})`); return; }
    want.push({ id, why, at, mark: m.slug });
  };

  // S1 THE BERTH. Every arrival stands here — "arrivals stand at
  // the-town/the-quay on the Long Run Harbor's stone edge" (world.mjs § the
  // BERTH quay is mark-sourced). If the apex is wrong anywhere, being wrong
  // here is wrong for every newcomer's first read.
  need("S1-berth", "the-town/the-quay — where every arrival stands", bySlug.get("the-town/the-quay"));

  // S2 THE VESSEL. #2392's own finding: "the apex cannot route ANY standpoint
  // to this door". The Post Office is the carrier; a read taken aboard is the
  // one that grows `frame`, and the one this port most needs measured.
  need("S2-vessel", "the-town/the-post-office — aboard the carrier", bySlug.get("the-town/the-post-office"));

  // S3 THE ORIGIN. The grid origin and the default standpoint for
  // everyone unplaced, and the AB report's own probe point ("apex granted.here
  // at 0,0 | 12 actions | 12 resident/* grants").
  want.push({ id: "S3-origin", why: "{0,0} — the Origin, the default standpoint", at: { x: 0, y: 0 }, mark: null });

  // S4 THE COMMONS. The harbor reach — public ground nobody's household holds,
  // which is where an ambient grant must stand alone with no ground channel
  // under it.
  need("S4-commons", "the-town/the-harbor-reach — public ground", bySlug.get("the-town/the-harbor-reach") ?? bySlug.get("the-town/the-quay-reach"));

  // S5 THE GROUND CHANNEL, LIVE. The runbook names "a human lane", and the
  // honest answer at this law is that there is not one: the only `for: "human"`
  // grant in the projection sits on the `human` class itself, which is an ACTOR
  // class, not a ground — so no standpoint in this world hands a human feet.
  // That absence is REPORTED (`notes` below), not worked around, because a
  // requirement the world genuinely cannot satisfy is a finding.
  //
  // What the human lane was chosen to exercise is the GROUND CHANNEL — the
  // clause that reached nothing for eleven days in 1.0 — so the sample takes
  // the standpoint that does exercise it: a ground whose class MINTS. Found
  // from the law and the register together, never from a name.
  const humanClasses = await humanGrantingClasses();
  if (!humanClasses.size || ![...humanClasses].some((c) => marks.some((m) => m.data?.class === c)))
    notes.push(`no HUMAN LANE exists at law ${LAW_SHA.slice(0, 8)}: the classes granting for: "human" are [${[...humanClasses].join(", ") || "none"}] and the register holds no standing instance of any of them. The runbook's fifth standpoint class is unrepresentable in this world, and S5 stands in for what it was chosen to test — the ground channel.`);
  const minting = await mintingClasses();
  const grounded = marks.find((m) => m.data?.class && minting.has(m.data.class));
  need("S5-ground-grant", `a ground whose class mints (${grounded?.data?.class ?? "none"}) — the ground channel, live`, grounded);

  // S6 INSIDE A BUILDING. A sited mark that a parcel CONTAINS — the nested
  // spine, which is the shape `containmentChain`'s ancestry nest exists for and
  // the one a flat "which marks contain this point" would get wrong.
  const parcels = marks.filter((m) => m.kind === "parcel");
  const inside = marks.find((m) => m.kind === "sited" && parcels.some((p) => contains(p, centreOf(m))));
  need("S6-inside", "a sited mark standing inside a parcel — the nested spine", inside);

  // S7 A PARCEL CENTRE. Somebody's own ground, where the ground channel's
  // own-ground scope is live.
  need("S7-parcel", "a household's parcel centre", parcels[0]);

  // S8 OPEN GROUND. Far from everything: the spine is the world frame alone and
  // the FOV is the far band. The answer a port most easily gets "right" by
  // accident, which is why it is in the sample rather than assumed.
  want.push({ id: "S8-open", why: "open ground, far from every mark", at: { x: -9000, y: 9000 }, mark: null });

  // S9…S12+ THE SPREAD. Deterministic, not random: every k-th parcel by slug,
  // so two runs of this falsifier compare the same standpoints and a divergence
  // is reproducible by re-running rather than by luck.
  const spread = Math.max(1, Math.floor(parcels.length / 6));
  for (let i = 0, n = 0; i < parcels.length && n < 6; i += spread, n += 1)
    need(`S${9 + n}-spread`, `parcel ${parcels[i]?.slug} — the deterministic spread`, parcels[i]);

  if (missing.length) die(`the sample cannot be built — the store holds no standpoint for: ${missing.join(" · ")}. A shrunken sample that still reported twelve greens is the failure this refuses.`);
  if (want.length < 12) die(`only ${want.length} standpoints could be built and the GO asks for at least 12`);
  return Object.assign(want, { notes });
}

function contains(parcel, pt) {
  if (!pt) return false;
  const g = parcel?.geometry; const at = g?.at, ex = g?.extent;
  if (!at || !ex) return false;
  return Math.abs(pt.x - Number(at.x)) <= Number(ex.w ?? 0) / 2 && Math.abs(pt.y - Number(at.y)) <= Number(ex.h ?? 0) / 2;
}

/** The classes whose law grants anything `for: "human"`, read from the pin. */
async function humanGrantingClasses() {
  const { rows } = await pool.query(
    "SELECT data FROM law_projection WHERE law_sha = $1 AND kind = 'grant' AND data->>'for' = 'human'", [LAW_SHA]);
  return new Set(rows.map((r) => r.data?.class).filter(Boolean));
}

/** The classes that MINT a verb at the pin — the gate's sixth clause, as data. */
async function mintingClasses() {
  const { rows } = await pool.query(
    "SELECT key FROM law_projection WHERE law_sha = $1 AND kind = 'class' AND (data ? 'actions' OR data ? 'affordances')", [LAW_SHA]);
  return new Set(rows.map((r) => r.key));
}

// ── the law pin, resolved once and shared by both sides ─────────────────────
let LAW_SHA = arg("--law-sha");
{
  if (!LAW_SHA) {
    const { rows } = await pool.query(
      "SELECT law_sha FROM windows WHERE law_sha IS NOT NULL ORDER BY id DESC LIMIT 1");
    LAW_SHA = rows[0]?.law_sha ?? null;
  }
  if (!LAW_SHA) die("no law_sha to pin: no window carries one and none was given with --law-sha");
  const { rows } = await pool.query("SELECT count(*)::int c FROM law_projection WHERE law_sha = $1", [LAW_SHA]);
  if (!rows[0]?.c) die(`law_projection holds no rows at ${LAW_SHA} — nothing to compose granted/actions/terms from`);
}

// ── THE DRIFT SET — measured once, named, and reported ──────────────────────
//
// Which residents' walk records the two stores disagree about. The oracle's
// clone is frozen at `sandbox/seed`; `acts` has kept taking the live mirror. A
// handle whose most recent departure differs between the two has MOVED since
// the freeze, and comparing their rendered position would measure the town's
// last week rather than this port.
//
// This is measured from the records themselves, not assumed from dates: both
// sides' governing departure per handle, compared by instant and target. The
// SIZE of this set is printed every run, so nobody has to trust that it stayed
// small — and a run where it swallows the whole sample is visibly a run that
// tested nothing.
const DRIFTED = new Set();
let driftDetail = { pg: 0, one: 0 };
{
  const live = await import("./live-reads.mjs");
  const { rows } = await pool.query(
    `SELECT id, at, crossing, actor, action, payload FROM acts WHERE action = ANY($1) ${live.DEPARTURE_ORDER_SQL}`,
    [live.DEPARTURE_ACTIONS]);
  const pgRecords = live.departureRecords(rows).records;
  const worldMod = await import("../../src/world.mjs");
  const oneRaw = await worldMod.departuresAcrossEras(REPO, {});
  const oneList = Array.isArray(oneRaw) ? oneRaw : (oneRaw?.records ?? oneRaw?.departures ?? []);
  driftDetail = { pg: pgRecords.length, one: oneList.length };
  const latest = (list) => { const m = new Map(); for (const d of list) m.set(d.handle, `${d.iso ?? d.at ?? ""}|${JSON.stringify(d.toward ?? null)}|${d.targetMarkId ?? d.to ?? ""}`); return m; };
  const a = latest(oneList), b = latest(pgRecords);
  for (const h of new Set([...a.keys(), ...b.keys()])) if (a.get(h) !== b.get(h)) DRIFTED.add(h);

  // ── THE SECOND SOURCE IS GONE (POS-269) ──────────────────────────────
  //
  // A6 used to read 1.0's presence BAKE too — `governingDepartures` over
  // dynamic.db's crystallized `entities` table — and excluded, by name, the
  // handles that bake had not caught up to (found on `postmaster`: the same
  // departure in both records, placed differently because the bake lagged).
  // Presence reads the position projection now, which keeps every departure
  // current in the step it is written; there is no bake to lag, so there is no
  // bake-lag exclusion. Only a governing departure that DIFFERS between the
  // two records is drift.
}

// ── the comparator ──────────────────────────────────────────────────────────
//
// Structural, not string. `JSON.stringify` on two objects with the same keys in
// a different insertion order compares unequal for no reason a reader would
// accept, and this port builds its objects with different spread order than the
// original in several places. So keys are SORTED before comparison and the
// difference is reported by PATH, which is what makes a divergence actionable
// ("nearby[3].distance_m" beats "the nearby block").
function diffs(a, b, path = "", out = [], depth = 0) {
  if (depth > 12) return out;
  if (a === b) return out;
  const ta = kindOfValue(a), tb = kindOfValue(b);
  if (ta !== tb) { out.push({ path: path || "(root)", one: brief(a), two: brief(b) }); return out; }
  if (ta === "array") {
    if (a.length !== b.length) out.push({ path: `${path}.length`, one: a.length, two: b.length });
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) diffs(a[i], b[i], `${path}[${i}]`, out, depth + 1);
    return out;
  }
  if (ta === "object") {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    for (const k of keys) {
      if (!(k in a)) { out.push({ path: `${path}.${k}`, one: "(absent)", two: brief(b[k]) }); continue; }
      if (!(k in b)) { out.push({ path: `${path}.${k}`, one: brief(a[k]), two: "(absent)" }); continue; }
      diffs(a[k], b[k], `${path}.${k}`, out, depth + 1);
    }
    return out;
  }
  // Numbers: EXACT. A tolerance here would hide the one class of defect this
  // door is most likely to have — a coordinate assembled from the wrong column.
  out.push({ path: path || "(root)", one: brief(a), two: brief(b) });
  return out;
}
const kindOfValue = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "object" ? "object" : typeof v);
const brief = (v) => { const s = typeof v === "string" ? v : JSON.stringify(v); return s == null ? String(v) : (s.length > 120 ? `${s.slice(0, 117)}…` : s); };

// ── the two answers ─────────────────────────────────────────────────────────

// THE ROLL, ONCE, FROM THE STORE — and handed to BOTH sides. DEC-11 (2026-09-03)
// made the town roll the default roster of `present` on both doors on
// 2026-09-04; server.mjs hands 1.0's apex `townRoll()` from the office index,
// and the 2.0 door reads `town_roll` at the town head. This falsifier has no
// office index, so it reads the same `town_roll` rows the port reads and hands
// them to 1.0 — otherwise A6 compares a two-term roster against a three-term
// one and "compared 0" is the only honest answer it can give (seen 09-04).
let ROLL = null;
async function townRollFromStore() {
  if (ROLL) return ROLL;
  const { rows } = await pool.query(`SELECT r.handle FROM town_roll r
     JOIN projection_heads h ON h.repo = 'town' AND h.sha = r.town_sha
    ORDER BY r.handle`);
  ROLL = rows.map((r) => r.handle);
  return ROLL;
}

async function oracleAt({ x, y }) {
  const r = await worldApex({ x: String(x), y: String(y) }, null, { roll: await townRollFromStore() });
  if (r?.error) throw new Error(`1.0 apex bounced at ${x},${y}: ${r.defect ?? r.error}`);
  return r;
}

async function portAt({ x, y }) {
  const sp = new URLSearchParams({ x: String(x), y: String(y), law_sha: LAW_SHA });
  const r = await world2Apex(sp, { p: pool });
  if (r?.error) throw new Error(`/world2/apex bounced at ${x},${y}: ${JSON.stringify(r.error.body)}`);
  return r.body;
}

// ── A5 · terms, built by ONE builder from TWO laws ──────────────────────────
//
// `buildTerms` is imported and shared on purpose. If each side built its own
// terms, a green would mean "two term-builders agree" — the standing lane's own
// warning, inverted. Here the builder is fixed and the LAW is the variable,
// which is the only thing B2 changed.
function termsFromStore(db, storeRows, entry, spine) {
  const affording = { ...storeRows.find((r) => r.id === entry.from), blurb: entry.blurb };
  const means = entry.blurb_from ? residueOf(db, entry.blurb_from) : null;
  return buildTerms({ affording, spine, means });
}
function termsFromLaw(lawRows, classRows, entry, spine) {
  const affording = { ...classRows.find((r) => r.id === entry.from), blurb: entry.blurb };
  const means = entry.blurb_from ? portMod.residueFromLaw(lawRows, entry.blurb_from) : null;
  return buildTerms({ affording, spine, means });
}

// ── the run ─────────────────────────────────────────────────────────────────

let PROVING = false;    // the can-fail proof suspends acknowledgements — see proveCanFail
const eq = new Map();   // id -> { compared, reds: [], amber: [] }
const scope = [];       // per standpoint: how much of `present` A6 could reach
const bump = (id, key, v) => { const e = eq.get(id) ?? { compared: 0, reds: [], amber: [] }; e[key] = key === "compared" ? e.compared + v : e[key]; eq.set(id, e); };
const record = (id, standpoint, found) => {
  const e = eq.get(id) ?? { compared: 0, reds: [], amber: [] };
  for (const d of found) {
    const ack = PROVING ? null : ackFor(d.path);
    (ack && !STRICT ? e.amber : e.reds).push({ standpoint, ...d, ...(ack ? { acknowledged: ack.id } : {}) });
  }
  eq.set(id, e);
};

async function runOne(sp, { breakage = null } = {}) {
  const one = await oracleAt(sp.at);
  let two = await portAt(sp.at);
  if (breakage) two = breakage(structuredClone(two));

  // A1 · granted
  bump("A1", "compared", 1);
  record("A1", sp.id, diffs(sortGranted(one.granted), sortGranted(two.granted), "granted"));

  // A2 · actions — sorted by (action, from, channel) so the comparison is about
  // membership and content, and A2b below is what holds the ORDER on trial.
  bump("A2", "compared", (one.actions ?? []).length);
  record("A2", sp.id, diffs(normActions(one.actions), normActions(two.actions), "actions"));
  bump("A2b", "compared", 1);
  record("A2b", sp.id, diffs((one.actions ?? []).map((e) => e.action), (two.actions ?? []).map((e) => e.action), "actions[].order"));

  // A3 · within
  bump("A3", "compared", (one.within ?? []).length);
  record("A3", sp.id, diffs(one.within ?? [], two.within ?? [], "within"));

  // A4 · nearby — membership first, then order, because they fail for
  // different reasons and a reader must be able to tell a MISSING mark from a
  // mis-RANKED one.
  bump("A4", "compared", (one.nearby ?? []).length);
  record("A4", sp.id, diffs([...(one.nearby ?? [])].map((o) => o.id).sort(), [...(two.nearby ?? [])].map((o) => o.id).sort(), "nearby[].members"));
  bump("A4b", "compared", 1);
  record("A4b", sp.id, diffs((one.nearby ?? []).map((o) => o.id), (two.nearby ?? []).map((o) => o.id), "nearby[].order"));

  // A5 · terms
  const store = openStore();
  try {
    if (!store.db) die(`the 1.0 world store cannot be opened (${store.unavailable}) — terms is the class layer's answer and the class layer lives there. Run it where the world graph snapshot loads (WORLD2_PG_URL at the store this PG was seeded beside).`);
    const spineIds = (one.within ?? []).map((m) => m.id);
    const reachIds = (one.nearby ?? []).map((o) => o.id);
    const amb = gatherActions(store.db, { spineIds, reachIds });
    const grd = gatherGroundActions(store.db, { spineIds, reachIds });
    const storeRows = [...amb.rows, ...grd.classRows];
    const { rows: lawRows } = await pool.query(portMod.LAW_ROWS_SQL, [LAW_SHA, portMod.LAW_KINDS_FOR_APEX]);
    const classRows = portMod.classRowsFromLaw(lawRows);
    for (const entry of one.actions ?? []) {
      const twin = (two.actions ?? []).find((e) => e.action === entry.action && e.from === entry.from);
      if (!twin) continue; // A2 already owns the missing-card red; no double count
      bump("A5", "compared", 1);
      record("A5", `${sp.id}/${entry.action}`, diffs(
        termsFromStore(store.db, storeRows, entry, one.within ?? []),
        termsFromLaw(lawRows, classRows, twin, two.within ?? []),
        `terms[${entry.action}]`));
    }
  } finally { store.db?.close(); }

  // A6 · present — SCOPED TO THE HANDLES BOTH SIDES HOLD, and the scoping is
  // the honest move rather than a softening.
  //
  // The oracle's clone runs under LEDGER_FREEZE at `sandbox/seed`; world2_dev's
  // `acts` has kept taking the live mirror since. Measured 2026-09-03: 1774
  // departure acts over 80 handles in Postgres against 317 over 50 in the 1.0
  // store, and PG is a strict SUPERSET (0 handles in 1.0 that PG lacks). So a
  // whole-answer `count`/`shown`/`capped` comparison would be measuring how
  // much the town walked since the freeze, not whether this port derives
  // presence correctly. That is `falsifier-live-equality.mjs`'s own E2 ruling —
  // "scoped to the rows the store holds — the 13 the journal carries are not a
  // disagreement" — applied one door over.
  //
  // What IS on trial here, and is compared in full: the apex's own RENDER of a
  // resident — distance, quantized bearing, distance band, rounded point,
  // provenance and motion — for every handle both answers name. The union
  // itself is already on trial at /world2/present under the live falsifier;
  // duplicating it here would be a second answer to a question already asked.
  const oneBy = new Map((one.present?.residents ?? []).map((r) => [r.handle, r]));
  const twoBy = new Map((two.present?.residents ?? []).map((r) => [r.handle, r]));
  // DRIFTED handles are excluded and COUNTED, never quietly forgiven: a
  // resident whose most recent departure exists in one store and not the other
  // is a person who moved since the freeze, and their position differing is the
  // record being right rather than the port being wrong. Every OTHER shared
  // handle must render identically, so the equality can still fail.
  const shared = [...oneBy.keys()].filter((h) => twoBy.has(h) && !DRIFTED.has(h)).sort();
  bump("A6", "compared", shared.length);
  for (const h of shared) record("A6", `${sp.id}/${h}`, diffs(normResident(oneBy.get(h)), normResident(twoBy.get(h)), `present.residents[${h}]`));
  // The scope itself is REPORTED, never silent: a reader must be able to see
  // how much of each answer this equality did not reach.
  scope.push({ standpoint: sp.id, one: oneBy.size, two: twoBy.size, shared: shared.length,
               drifted: [...oneBy.keys()].filter((h) => twoBy.has(h) && DRIFTED.has(h)),
               one_only: [...oneBy.keys()].filter((h) => !twoBy.has(h)), two_only: [...twoBy.keys()].filter((h) => !oneBy.has(h)).length });
  // The frame-shaped aggregates, kept visible as their own acknowledged row
  // rather than dropped — AD-4 names why they cannot agree against this pair.
  bump("A6b", "compared", 1);
  record("A6b", sp.id, diffs({ radius_m: one.present?.radius_m ?? null, at: one.present?.at ?? null },
                             { radius_m: two.present?.radius_m ?? null, at: two.present?.at ?? null }, "present.bounds"));

  // A7 · the key set
  bump("A7", "compared", 1);
  record("A7", sp.id, diffs(Object.keys(one).sort(), Object.keys(two).filter((k) => k !== "disclosed").sort(), "keys"));

  // A8 · records — the id SET first (a record missing from the block is the
  // whole floor going missing under one tile), then every record both sides
  // carry, field by field, under a path the acknowledgements can name. The
  // per-id path is `records[<id>]` on purpose: `ackFor` folds every bracket to
  // `[]`, so an absence the store owns by name (AD-5, AD-6) is amber on every
  // mark and a wrong value on any mark is red.
  const oneRec = one.records ?? {}, twoRec = two.records ?? {};
  const oneIds = Object.keys(oneRec).sort(), twoIds = Object.keys(twoRec).sort();
  bump("A8", "compared", oneIds.length);
  record("A8", sp.id, diffs(oneIds, twoIds, "records.ids"));
  for (const id of oneIds) if (id in twoRec) record("A8", sp.id, diffs(oneRec[id], twoRec[id], `records[${id}]`));
}

const sortGranted = (g) => Object.fromEntries(Object.entries(g ?? {}).map(([k, v]) => [k, [...(v ?? [])].sort()]));
const normActions = (list) => [...(list ?? [])]
  .map((e) => { const { grant, ...rest } = e; return { ...rest, grant }; })
  .sort((a, b) => `${a.action}|${a.from}|${a.channel}`.localeCompare(`${b.action}|${b.from}|${b.channel}`));
// `place`, `as_of`, `evaluated_at`, `ledger_moved` and `disclosed` are the
// office's own bookkeeping and a clock; comparing a clock is comparing when the
// two calls ran. The RESIDENTS and the counts are the answer.
// `place` is the office's own place-words fold and `standing`/`aboard` are the
// frame half (AD-2) — the first is not a presence fact and the second is one
// this store cannot state. Everything else about a rendered resident is here.
const normResident = (r) => {
  if (!r) return null;
  const { place, standing, aboard, ...keep } = r;
  return keep;
};

// ── the can-fail proof ──────────────────────────────────────────────────────
//
// A green from a check nobody proved can fail is not a receipt. Each break
// below is a plausible defect of THIS port — not a nonsense mutation — applied
// to the port's answer in memory, and every one must turn the run red.
const BREAKS = [
  { id: "A1", why: "a class the projection admits that the store's gate refuses — one extra grant in `granted.here`",
    fn: (b) => { b.granted.here = [...b.granted.here, "conjure"]; return b; } },
  { id: "A2", why: "a blurb quoted from the wrong residue — the drift the pointer exists to prevent",
    fn: (b) => { if (b.actions[0]) b.actions[0].blurb = "a paraphrase that reads like law"; return b; } },
  { id: "A2b", why: "the ground/ambient precedence resolving the other way — the cards in the wrong order",
    fn: (b) => { b.actions = [...b.actions].reverse(); return b; } },
  { id: "A3", why: "a lost `points:` ring, so the spine falls back to the bbox and admits one mark too many",
    fn: (b) => { b.within = b.within.slice(0, Math.max(0, b.within.length - 1)); return b; } },
  { id: "A4", why: "a mark dropped from the field of view — the salience budget cutting the wrong tail",
    fn: (b) => { b.nearby = b.nearby.slice(1); return b; } },
  // ⚑ NOT "point the card at a class that does not exist". A5 pairs cards by
  // (action, from), so re-pointing `from` unpairs the card and A5 compares one
  // FEWER instead of disagreeing — the break landed in A2 and proved A2 twice.
  // This one moves the residue pointer, which is the input `terms.means` is
  // built from and the exact drift the pointer exists to prevent.
  { id: "A5", why: "terms composed from something other than law_projection — the residue pointer moved, so `means` quotes the wrong class",
    fn: (b) => { for (const e of b.actions ?? []) if (e.blurb_from) e.blurb_from = "the-town/resident"; return b; } },
  // ⚑ NOT "drop a resident" — A6 is scoped to the handles both sides hold, so a
  // dropped row shrinks the scope instead of failing the equality, and the
  // break would pass while proving nothing. This is the defect A6 can actually
  // see: a resident RENDERED wrongly at a point both answers name.
  { id: "A6", why: "a resident rendered at the wrong bearing — the compass the telling and the map share",
    fn: (b) => { for (const r of b.present?.residents ?? []) { r.bearing = "NNE"; r.distance_m = (r.distance_m ?? 0) + 7; } return b; } },
  { id: "A6b", why: "the presence bound moved — a radius nobody declared, so a caller reads a different question's answer",
    fn: (b) => { if (b.present) b.present.radius_m = 999; return b; } },
  { id: "A7", why: "a top-level key going quietly missing — the failure a value comparison cannot see",
    fn: (b) => { delete b.granted; return b; } },
  // ⚑ NOT "delete b.records" — that is A7's break wearing a different key, and
  // it would prove A7 twice. This is the defect A8 exists to see: the block is
  // present, the ids are right, and ONE record inside it is wrong — the
  // `parent` read off the directory instead of the authored line, which is
  // exactly the shape the first cut shipped (apex-reads.mjs § markRecordOf).
  { id: "A8", why: "a record inside `records` going wrong while the block and its id set stay right — a nested sited mark handed the directory edge as its `parent`",
    fn: (b) => { for (const r of Object.values(b.records ?? {})) if (r.kind === "sited" && !("parent" in r)) { r.parent = "the-town/let-there-be-light"; break; } return b; } },
];

async function proveCanFail(sample) {
  const at = sample[0];
  const results = [];
  // ⚠ THE PROOF RUNS WITH ACKNOWLEDGEMENTS OFF, AND AGAINST A BASELINE.
  //
  // The first version did neither and A4's break came back MISSED — a mark
  // dropped from the field of view produced an AMBER, because A4's divergences
  // are acknowledged under AD-1, and the proof was counting reds. A break that
  // lands inside an acknowledged field is exactly the break most worth proving:
  // it is where an acknowledgement could quietly become a blindfold.
  //
  // So acknowledgements are suspended here (`PROVING`) and each break must
  // produce MORE divergences than the same standpoint produces unbroken. A
  // bare count would pass every break trivially once the acknowledgements are
  // off, since the amber rows become reds on their own.
  PROVING = true;
  eq.clear();
  await runOne(at);
  const baseline = [...eq.values()].reduce((n, e) => n + e.reds.length, 0);
  // ⚠ A SIGNATURE, NOT A COUNT. `diffs` over two arrays of different lengths can
  // emit the same NUMBER of paths for a different set of them — A4's drop-a-mark
  // break came back 11 -> 11 and passed only on the whole-run total, which
  // proves the run and not the equality. The signature is the sorted set of
  // (path, values) the equality reported, so any change in WHAT it disagreed
  // about counts even when HOW MUCH did not.
  const sig = (e) => JSON.stringify((e?.reds ?? []).map((d) => `${d.standpoint}|${d.path}|${d.one}|${d.two}`).sort());
  const perEq = new Map([...eq.entries()].map(([id, e]) => [id, { n: e.reds.length, s: sig(e) }]));
  for (const brk of BREAKS) {
    eq.clear();
    let threw = null;
    try { await runOne(at, { breakage: brk.fn }); }
    catch (e) { threw = String(e.message).slice(0, 160); }
    const reds = [...eq.values()].reduce((n, e) => n + e.reds.length, 0);
    // Named-equality first: the break must move ITS OWN equality, not merely
    // disturb the total. A break that reds a different check is a break that
    // proved a different check.
    const e = eq.get(brk.id);
    const before = perEq.get(brk.id) ?? { n: 0, s: "[]" };
    const mine = e?.reds.length ?? 0;
    // ITS OWN EQUALITY MUST MOVE. A break that only disturbs the total proved a
    // different check, and a proof that accepts that is a proof of nothing.
    const caught = Boolean(threw) || sig(e) !== before.s;
    results.push({ break: brk.id, why: brk.why, caught, reds, baseline, own: mine, own_baseline: before.n, ...(threw ? { threw } : {}) });
  }
  PROVING = false;
  eq.clear();
  return results;
}

// ── main ────────────────────────────────────────────────────────────────────

let sample, proof = null;
try {
  sample = await buildSample();
  if (PROVE) proof = await proveCanFail(sample);
  for (const sp of sample) await runOne(sp);
} catch (e) {
  await pool.end().catch(() => {});
  die(`the run could not complete: ${e.message}`);
}

const rows = [...eq.entries()].map(([id, e]) => ({ id, compared: e.compared, reds: e.reds.length, amber: e.amber.length, examples: e.reds.slice(0, 4), acknowledged: e.amber.slice(0, 4) }));
const zero = rows.filter((r) => r.compared === 0);
const totalReds = rows.reduce((n, r) => n + r.reds, 0);
const totalAmber = rows.reduce((n, r) => n + r.amber, 0);
const proofFailed = (proof ?? []).filter((p) => !p.caught);
const ackUnseen = ACKNOWLEDGED.filter((a) => !rows.some((r) => r.acknowledged?.some?.((x) => x.acknowledged === a.id)));

await pool.end().catch(() => {});

if (JSON_OUT) {
  console.log(JSON.stringify({ law_sha: LAW_SHA, standpoints: sample.map((s) => ({ id: s.id, at: s.at, mark: s.mark })), equalities: rows, acknowledged: ACKNOWLEDGED, can_fail: proof, strict: STRICT }, null, 2));
} else {
  console.log(`apex equality · law ${LAW_SHA.slice(0, 8)} · ${sample.length} standpoints`);
  for (const s of sample) console.log(`    ${s.id.padEnd(16)} (${s.at.x}, ${s.at.y})  ${s.why}`);
  for (const nte of sample.notes ?? []) console.log(`  ⚑ ${nte}`);
  console.log("");
  for (const r of rows) {
    const flag = r.reds ? "RED " : r.amber ? "AMBER" : "  · ";
    console.log(`  ${flag} ${r.id.padEnd(4)} compared ${String(r.compared).padStart(5)}  reds ${r.reds}  acknowledged ${r.amber}`);
    for (const d of r.examples) console.log(`         ✗ ${d.standpoint} ${d.path}: 1.0 ${d.one}  ·  2.0 ${d.two}`);
    for (const d of r.acknowledged) console.log(`         ~ ${d.standpoint} ${d.path} [${d.acknowledged}]: 1.0 ${d.one}  ·  2.0 ${d.two}`);
  }
  const reach = scope.reduce((a, s) => ({ one: a.one + s.one, two: a.two + s.two, shared: a.shared + s.shared, one_only: a.one_only + s.one_only.length, drifted: a.drifted + s.drifted.length }), { one: 0, two: 0, shared: 0, one_only: 0, drifted: 0 });
  console.log(`\n  A6's scope: ${reach.shared} of 1.0's ${reach.one} rendered residents compared across ${scope.length} standpoints (2.0 named ${reach.two}).`);
  console.log(`         the drift set: ${DRIFTED.size} handles (${driftDetail.one} departure records in the frozen 1.0 clone, ${driftDetail.pg} in acts) — ${reach.drifted} rendered rows skipped for it.`);
  if (reach.one_only) console.log(`         handles 1.0 named and 2.0 did not: ${[...new Set(scope.flatMap((s) => s.one_only))].join(", ")}`);
  if (totalAmber) {
    console.log("\n  acknowledged divergences, and the 1.0 line that produces each:");
    for (const a of ACKNOWLEDGED) console.log(`    ${a.id} ${a.field}\n        ${a.because}\n        closes with: ${a.closes_with}`);
  }
  if (proof) {
    console.log("\n  the can-fail proof:");
    for (const p of proof) console.log(`    ${p.caught ? "caught" : "MISSED"}  ${String(p.break).padEnd(4)} ${String(p.own_baseline).padStart(3)} -> ${String(p.own).padStart(3)}  ${p.why}${p.threw ? ` (threw: ${p.threw})` : ""}`);
  }
}

if (zero.length) { console.error(`\nCANNOT RUN · ${zero.map((z) => z.id).join(", ")} compared 0 — a green that checked nothing is not a receipt`); process.exit(2); }
if (proofFailed.length) { console.error(`\nCANNOT RUN · ${proofFailed.map((p) => p.break).join(", ")} did not turn red when broken — this falsifier cannot fail, so its green means nothing`); process.exit(2); }
if (totalReds) { console.error(`\nRED · ${totalReds} unacknowledged divergence${totalReds === 1 ? "" : "s"}`); process.exit(1); }
console.log(`\nGREEN · every equality holds${totalAmber ? ` (${totalAmber} acknowledged divergence${totalAmber === 1 ? "" : "s"}, listed above; --strict makes them red)` : ""}`);
process.exit(0);
