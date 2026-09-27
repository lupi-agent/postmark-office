// parcel-cap.mjs — THE CLEARING ASKS THE PARCEL CAP THE SWEEP ASKS.
//
// ── THE GAP, MEASURED (POS-98 box 4, the S71 instance) ──────────────────────
//
// The candle admitted Mari's parcel at window 191's close and the sweep refused
// it three minutes later. Two gates, two answers, twelve hours apart, and the
// resident learned the second one from a person.
//
// `clearing-job.mjs` steps 1-5.5 are, in full: duplicate slug, supersession,
// escrow SUFFICIENCY, parcel overlap against standing ground, the counterclaim
// rule, and commons escrow PRESENCE. Not one of them counts how many parcels a
// household holds. The cap lives in the world's own fold
// (`tools/marks-fold.mjs § PARCEL_CLAIM_CAP`, Keemin 2026-07-30) and is asked by
// `tools/settlement-sweep.mjs` AFTER the clearing has already said yes.
//
// So this is the escrow-presence move again, one gate over: the sweep's rule,
// ported to the candle, so a capped claim is refused AT THE CLOSE with its
// reason on the docket rather than by the sweep after it. The sweep's own check
// stays exactly where it is — it is the gate of last resort and this file does
// not touch it.
//
// ── THE LAW IS IMPORTED, NEVER COPIED, AND THAT IS THE WHOLE POINT ──────────
//
// `PARCEL_CLAIM_CAP`, `PARCEL_CAP_LAW_DATE` and `PARCEL_CAP_EXCEPTIONS` are
// exported by the world's `tools/marks-fold.mjs`, and `parcelCapLawAt` reads
// them out of a world checkout the caller supplies — the same route
// `canon-register.mjs § canonRegisterAt` already takes to `loadMarks`, and the
// same `--world-repo` argument `falsifier-canon-locks.mjs` already takes. A
// second copy of the number, the date or the exception list is how the two gates
// come to disagree, which is the defect this file exists to end and not a new
// spelling of it.
//
// `compareClaimOrder` is imported for the same reason. The cap refuses the
// claim that arrives when the household is already full, so WHICH of several
// simultaneous claims is refused is decided entirely by the order the loop runs
// in — the world made that a function of the record rather than of a directory
// walk, and a second ordering here would undo it at this gate only.
//
// ── WHAT IS NOT IMPORTABLE, AND IS THEREFORE FLAGGED ────────────────────────
//
// THE SENTENCE. `marks-fold.mjs` composes its refusal text inline at BOTH of its
// own cap sites (:876 and :1806) and exports no function for it, so there is no
// function to import. This file composes the same sentence FROM THE SAME THREE
// CONSTANTS, which means the numbers, the date and the exception set can never
// drift — only the words could, and only if somebody re-words two inline strings
// in the world without touching this one. That is a third holder of one
// sentence, it is a real seam, and extracting it is the WORLD's to do: this lane
// is the office's and does not edit the fold.
//
// ── AND WHAT IT REFUSES TO GUESS ────────────────────────────────────────────
//
// An unreadable world checkout THROWS. It does not fall back to a default cap,
// an empty exception map or a permissive answer. An empty `PARCEL_CAP_EXCEPTIONS`
// is not "no exceptions granted" — it is the founder's five rulings missing, and
// it would refuse Mari's parcel again, and the Reeves' gauge house, and deva's
// household's five, on the quietest possible code path. The sibling's words for
// the same rule: "an empty set here would refuse EVERY claim at the next
// crossing, which is the loudest possible wrong answer wearing the quietest
// possible code."

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { soloHouseIndex, soloHouseOf, isSolo } from "../../src/solo-adoption.mjs";

/** The check name this writes into `claims.refusal_check` — the prefix `causeOf` splits on. */
export const PARCEL_CAP_CHECK = "parcel-cap";

/**
 * The `<name>: <detail>` string a refused claim carries.
 *
 * The detail is the fold's own sentence, composed from the fold's own three
 * constants — see the header on why it is composed here and not imported.
 */
export const parcelCapCheck = (slug, held, { cap, lawDate }) =>
  `${PARCEL_CAP_CHECK}: ${slug} — parcel claim capped — this credential household already holds ${held} ` +
  `(cap ${cap} per household, ruled ${lawDate}; prior estate stands, new claims wait on the founder's word)`;

/**
 * The cap's law, read out of a world checkout.
 *
 * Returns `{ cap, lawDate, exceptions, compare, sha, repo }`. Throws on anything
 * it cannot stand behind — see the header. `sha` is on the answer because a gate
 * that refuses a resident's ground must be able to name the law-as-of it refused
 * against, exactly as `canonRegisterAt` names the canon sha it read.
 */
export async function parcelCapLawAt(worldRepo) {
  const repo = resolve(String(worldRepo ?? ""));
  if (!worldRepo || !existsSync(repo))
    throw new Error(`parcelCapLawAt: no world checkout at ${JSON.stringify(worldRepo)} — the cap is the world's law and this side reads it from a checkout the caller supplies`);
  const fold = join(repo, "tools", "marks-fold.mjs");
  if (!existsSync(fold))
    throw new Error(`parcelCapLawAt: no tools/marks-fold.mjs under ${repo} — is this a world checkout?`);

  let sha;
  try {
    sha = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch (err) {
    throw new Error(`parcelCapLawAt: cannot read HEAD of ${repo} (${err.message}) — a refusal must be able to name the law it refused against`);
  }

  const mod = await import(pathToFileURL(fold).href);
  const { PARCEL_CLAIM_CAP, PARCEL_CAP_LAW_DATE, PARCEL_CAP_EXCEPTIONS, compareClaimOrder } = mod;

  // Each check names the constant it could not stand behind. A cap of 0 and a
  // missing export are different faults with the same symptom, and an operator
  // reading "the world answered no cap" must not have to guess which.
  if (!Number.isInteger(PARCEL_CLAIM_CAP) || PARCEL_CLAIM_CAP < 1)
    throw new Error(`parcelCapLawAt: ${repo} at ${sha.slice(0, 8)} answered PARCEL_CLAIM_CAP=${JSON.stringify(PARCEL_CLAIM_CAP)}, which is not a cap`);
  if (typeof PARCEL_CAP_LAW_DATE !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(PARCEL_CAP_LAW_DATE))
    throw new Error(`parcelCapLawAt: ${repo} at ${sha.slice(0, 8)} answered PARCEL_CAP_LAW_DATE=${JSON.stringify(PARCEL_CAP_LAW_DATE)}, which is not a law date`);
  // A Map with no `has` is the shape that would silently except nothing. The
  // EMPTINESS of a real Map is not checked and must not be: an exception list is
  // allowed to be empty in principle, and refusing to run over that would put
  // this gate's opinion above the founder's.
  if (typeof PARCEL_CAP_EXCEPTIONS?.has !== "function")
    throw new Error(`parcelCapLawAt: ${repo} at ${sha.slice(0, 8)} exports no PARCEL_CAP_EXCEPTIONS set — an absent exception list would refuse every founder-granted parcel`);
  if (typeof compareClaimOrder !== "function")
    throw new Error(`parcelCapLawAt: ${repo} at ${sha.slice(0, 8)} exports no compareClaimOrder — which of several claims the cap refuses must be a function of the record`);

  return { cap: PARCEL_CLAIM_CAP, lawDate: PARCEL_CAP_LAW_DATE, exceptions: PARCEL_CAP_EXCEPTIONS, compare: compareClaimOrder, sha, repo };
}

/**
 * Which of this window's parcel candidates the cap refuses.
 *
 * PURE. Takes the standing count per household and the law, and returns the
 * refusals — so the whole judgement is provable on a Map and four constants,
 * with no Postgres, no checkout and no crossing.
 *
 * @param candidates `[{ id, slug, cred, date, amending }]` — the surviving parcel
 *                   claims. `cred` is `materialize.mjs § ownerHouseholdFor`'s
 *                   answer, which is the fold's own `credHh` grain: the roster's
 *                   household key, else `solo:<handle>`.
 * @param heldByCred Map cred → standing parcels that household already holds.
 * @param law        `parcelCapLawAt`'s answer.
 *
 * ── THREE THINGS IT DOES NOT REFUSE, EACH FOR THE FOLD'S OWN REASON ─────────
 *
 * AN AMENDMENT of a parcel the household already holds (`amending`) — POS-88's
 * law, and `marks-fold.mjs:1805` spells it `!mk._replacing`: a relocation is a
 * replacement, not a second claim, and the household's count does not move.
 *
 * A PARCEL DATED ON OR BEFORE THE LAW DATE — "prior estate stands". The fold
 * compares `String(mk.date ?? "") > PARCEL_CAP_LAW_DATE`, and an ABSENT date is
 * therefore never post-law. That reading is deliberate on the world's side and
 * is kept here rather than tightened: a gate that refused an undated claim would
 * be stricter than the law it is porting.
 *
 * A MARK IN `PARCEL_CAP_EXCEPTIONS` — the founder's word, by mark id, which is
 * the slug. The count still rises for it, exactly as the fold's does: deva's
 * entry says so in its own text ("`held` still counts all five, so a SIXTH claim
 * by this household is refused").
 */
export function parcelCapRefusals(candidates, { heldByCred, law } = {}) {
  if (!law) throw new Error("parcelCapRefusals: no law — the cap is the world's and this function never supplies a default");
  const held = new Map(heldByCred ?? []);
  const refused = [];
  const admitted = [];

  // IN THE WORLD'S CLAIM ORDER, not the docket's arrival order. See the header:
  // which of several simultaneous claims meets a full household is a ruling, and
  // it is the world's.
  const ordered = [...(candidates ?? [])].sort((a, b) =>
    law.compare({ date: a?.date, id: a?.slug }, { date: b?.date, id: b?.slug }));

  for (const c of ordered) {
    const cred = c?.cred ?? null;
    const n = held.get(cred) ?? 0;
    const postLaw = String(c?.date ?? "") > law.lawDate;
    const excepted = law.exceptions.has(c?.slug);
    if (!c?.amending && postLaw && n >= law.cap && !excepted) {
      refused.push({ id: c.id, slug: c.slug, cred, held: n, check: parcelCapCheck(c.slug, n, law) });
      continue;
    }
    admitted.push({ id: c?.id, slug: c?.slug, cred, held: n, excepted, amending: !!c?.amending });
    // An amendment does not raise the count — it replaces a parcel already in it.
    if (!c?.amending) held.set(cred, n + 1);
  }
  return { refused, admitted };
}

/** The operator line a crossing prints about this gate. Composed here, asserted by the falsifiers. */
export function parcelCapLines({ refused = [], admitted = [] } = {}, law) {
  const lines = [];
  if (refused.length)
    lines.push(`parcel cap: refused ${refused.length} claim(s) whose household is at the cap ` +
      `(cap ${law?.cap ?? "?"} per household, ruled ${law?.lawDate ?? "?"}, world ${String(law?.sha ?? "?").slice(0, 8)}): ` +
      refused.map((r) => `${r.slug} (holds ${r.held})`).join(", "));
  const excepted = admitted.filter((a) => a.excepted);
  // NAMED, not counted. An exception admitted at the candle is the founder's word
  // being spent, and a reader should see whose.
  if (excepted.length)
    lines.push(`parcel cap: ${excepted.length} claim(s) admitted by founder exception: ` +
      excepted.map((a) => a.slug).join(", "));
  return lines;
}

/**
 * Standing parcels per household, at this store. The grain is `marks.household`.
 *
 * ── THE COUNT IS PER HOUSE, NOT PER SPELLING (POS-160 RULING 4) ─────────────
 *
 * `GROUP BY household` counts STRINGS. `marks.household` is written by
 * `materialize.mjs § ownerHouseholdFor` out of `identities`, which carries
 * whatever spelling the world repo's copy held when each row landed — measured
 * 2026-09-22, 173 of 190 handles `gh:<id>` and 17 `hh:<slug>`, and
 * umbraliminalis wearing both at once because a ledger re-key reached its first
 * resident and not its other seven.
 *
 * So a house holding three parcels under three spellings counted as three
 * households holding one each, and the cap — 3 per household — admitted a
 * FOURTH. That is the cap's quietest possible failure: the claim is granted at
 * the close with a receipt saying it was lawful, and the sweep refuses it twelve
 * hours later, which is the exact gap (POS-98 box 4, the S71 instance) this
 * whole file exists to have closed.
 *
 * THE STORE NEVER RE-SPELLS A ROW — three guards refuse it (022's retirement
 * header) — so the fold happens HERE, on the way out: every spelling resolves
 * through `household-deriver.mjs`, the office's one walk, to ONE house, and the
 * counts are summed per house. A row the deriver cannot name keeps its own
 * string as its key, unchanged and uncounted-with-anything: that is the
 * refuse-rather-than-guess rule, and a `solo:` row genuinely is its own house.
 *
 * @param resolve `(household) => slug | null`, the deriver bound to the caller's
 *                registry. Omitted, the counts are per RAW SPELLING exactly as
 *                before — the pre-024 answer, which is only correct on a store
 *                whose marks wear one spelling.
 */
export async function heldParcelsByCred(q, { resolve = null } = {}) {
  const { rows } = await q(
    "SELECT household, COUNT(*)::int AS n FROM marks WHERE kind = 'parcel' AND status = 'standing' GROUP BY household");
  const held = new Map();
  for (const r of rows) {
    const slug = typeof resolve === "function" ? resolve(r.household) : null;
    const key = slug ? `hh:${slug}` : r.household;
    held.set(key, (held.get(key) ?? 0) + r.n);
  }
  return held;
}

/**
 * The same fold, for the candidate side. `parcelCapRefusals` looks each
 * candidate's `cred` up in the map above, so the two must be folded by the SAME
 * rule or the lookup misses and every count reads zero — which would refuse
 * nothing at all, the loudest wrong answer wearing the quietest code.
 */
export const credOf = (household, resolve = null) => {
  const slug = typeof resolve === "function" ? resolve(household) : null;
  return slug ? `hh:${slug}` : household;
};

// ── THE COUNT AFTER ADOPTION (POS-212) ──────────────────────────────────────
//
// POS-160 pinned it: "a `solo:` parcel is READ by the house and not COUNTED at
// its cap" (test/household-spellings.test.mjs FALSIFIER 3d), because
// `resolveHouse` answers `unknown` for a `solo:` key and this fold keys an
// unknown spelling by its own string. Keemin's ruling (2026-09-23) closes the
// gap in order: adopt first — the ceremony, then ONE batch — and COUNT AFTER.
//
// THE FLIP IS A STORE FACT, NOT A FLAG. `world2/tools/adopt-solo.mjs` writes one
// `solo-counted` act after its last house commits; `soloCountedAt` reads it.
// A flag is a setting that can be true on prod before the batch has run there,
// and the count must never flip on a store that still holds unadopted `solo:`
// parcels — that would refuse a resident's new parcel against holdings the
// ruling said to grandfather first. An append-only act can exist only where the
// batch ran, and nothing un-sets it.
//
// WHAT "COUNTED" MEANS: a `solo:<x>` row is folded into the ONE house whose
// spelling set holds `solo:<x>` (`src/solo-adoption.mjs § soloHouseIndex`, the
// inverse of the set #166's policy reads). A spelling no house holds, or two
// houses hold, keeps its own string — refuse-rather-than-guess, as before.
export { soloCountedAt } from "../../src/solo-adoption.mjs";

/**
 * `resolve` widened to fold `solo:` spellings into their house — the resolver
 * `heldParcelsByCred` and `credOf` take once the count counts. PURE.
 */
export function countingSolo(resolve, registry, pins = {}) {
  const idx = soloHouseIndex(registry, pins);
  return (hh) => {
    const slug = typeof resolve === "function" ? resolve(hh) : null;
    if (slug) return slug;
    return isSolo(hh) ? soloHouseOf(idx, hh) : null;
  };
}
