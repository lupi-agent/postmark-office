// parcel-law.mjs — THE PARCEL LAW'S SENTENCES AT THE OFFICE'S DOORS (Darko, 2026-10-04; Linear POS-368).
//
// "One parcel per resident, three per household. Yes." The law lives in the
// world: two law marks in the Keeping Works (the-town/claim-cap, value 3, and
// the-town/one-per-resident), and the fold that enforces them
// (tools/marks-fold.mjs, whose ONE_PER_RESIDENT_REFUSAL is the sentence). The
// office's doors refuse the same thing one step earlier — before anything is
// written — so a resident reads the law's own sentence at the door instead of a
// quarantine at the next settlement.
//
// THE SENTENCE IS THE WORLD'S. `onePerResidentDefect(fold)` hands back the
// fold's own constant when the clone carries it, and this file's copy only when
// it does not (a box clone that has not pulled the law yet).
// test/parcel-law-door.test.mjs holds the copy byte-equal to the world's, so the
// two cannot drift apart silently.
//
// Pure: no fs, no engine import. The caller passes what the fold exported.

export const CLAIM_CAP_LAW = "the-town/claim-cap";
export const ONE_PER_RESIDENT_LAW = "the-town/one-per-resident";

/** The world's sentence, word for word (postmark-world tools/marks-fold.mjs § ONE_PER_RESIDENT_REFUSAL). */
export const ONE_PER_RESIDENT_SENTENCE =
  "this resident already holds a parcel; a household may hold up to three, one per resident "
  + `(${ONE_PER_RESIDENT_LAW}; relocation = replace, not add)`;

/** The defect a door says when a resident who holds a parcel claims another. */
export function onePerResidentDefect(fold = null) {
  const s = fold?.ONE_PER_RESIDENT_REFUSAL;
  return typeof s === "string" && s ? s : ONE_PER_RESIDENT_SENTENCE;
}

/** The hint beside it: which parcel they hold, and the two honest ways on. */
export function onePerResidentHint(heldId) {
  return `you hold ${heldId} — to move your ground, amend that parcel (amend: true, same slug); `
    + "a second parcel for one resident is the founder's word, not the door's. "
    + "A housemate may claim their own, within the household's three";
}

/** The cap's hint, naming both laws. Keeps "capped at N per household", which the door's falsifiers read. */
export function capHint(cap, lawDate) {
  return `parcel claiming is capped at ${cap} per household, one per resident (${CLAIM_CAP_LAW}, ruled ${lawDate}; `
    + "prior holdings stand) — new ground for this household is the founder's word, not the door's";
}

/** The parcels one resident already holds, other than the one being written. `byOf` reads a row's author. */
export function residentParcels(marks, by, exceptId = null) {
  const byOf = (m) => m?.by ?? (typeof m?.id === "string" ? m.id.split("/")[0] : null);
  return [...(marks ?? [])].filter((m) => m?.kind === "parcel" && byOf(m) === by && m.id !== exceptId);
}

/** Is this parcel prior estate under one-per-resident (the fold's own map)? */
export function isPriorEstate(fold, id) {
  const map = fold?.ONE_PER_RESIDENT_PRIOR_ESTATE ?? fold?.ONE_PARCEL_PER_HANDLE_EXCEPTIONS;
  return Boolean(map && typeof map.has === "function" && map.has(id));
}
