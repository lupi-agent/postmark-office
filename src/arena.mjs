// arena.mjs — THE ARENA IS CLOSED (Keemin, 2026-09-30).
//
// "The arena is not live; it will be reimplemented properly later, and nothing
// should be ported." So this is the whole of it now: the five verbs the class
// marks still grant, and one door that answers every one of them with the same
// plain refusal. There is no fold, no wheel, no ground lookup and no query: the
// arena reads nothing and writes nothing, in dynamic.db, in world.db, or
// anywhere else.
//
// WHAT WENT WITH IT: the encounter fold (encounter.mjs), the wheel's join and
// leave on a crossing, the encounter, acting_blocked and loose floor on the
// apex's read, the phase read that `loot`'s precondition asked, the loot shroud
// at the hold door, the walk desk's placement clear of an adversary, and the
// arena's sqlite journal writer.
//
// WHAT DID NOT: the PORTAL GROUND's own law (the room you stand in, its stride,
// its spawn, `standpoint.portal`). The rooms are walked with no fight in them,
// so that lives on in src/portal-ground.mjs. Its rows were archived once
// (tools/arena-archive.mjs) before the door closed. The implementation lives in
// git history (office train/2026-w41 before this commit) for whoever builds the
// arena again, and the brief says to build it, not port it.
//
// WHY THE VERBS STAY NAMED: the class marks on the record still grant strike,
// cast, guard, lift and loot, so `gatherActions` still affords them. A granted
// verb with no handler answers 501 "no handler for it", which reads like a
// fault. A closed door says what it is.

/** The arena's five verbs, as the class marks grant them. */
export const ARENA_VERBS = Object.freeze(["strike", "cast", "guard", "lift", "loot"]);

/** The one refusal, word for word, at every arena door. */
export const ARENA_CLOSED = "the arena is closed";
export const ARENA_CLOSED_HINT =
  "the arena is closed while it is rebuilt; its verbs do nothing until it reopens. Everything else in the town is as it was: walk, speak, stake and hand things over as ever.";

/** The refusal, in the error grammar every apex door uses (code, defect, hint). */
export function arenaClosed(action = null) {
  const e = new Error(ARENA_CLOSED);
  return Object.assign(e, { code: 501, defect: ARENA_CLOSED, hint: ARENA_CLOSED_HINT, ...(action ? { action } : {}) });
}

/** The arena's door: every verb, every caller, the same refusal. Reads nothing. */
export async function arenaActViaOffice(_worldClone, args = {}) {
  throw arenaClosed(args?.__action ?? null);
}

// ── the door's schema ───────────────────────────────────────────────────────
//
// ARENA_TOOLS ride the apex's SCHEMA lookup (seam 4: the fields an act takes
// come from the act's own schema) without joining the flat door's tool list.
// The fields are the ones the verbs always took, so an envelope that names
// them reaches the refusal rather than a field bounce.

const FIELD_OBJECT = { type: "string", description: "who or what this act was aimed at. The arena is closed, so it is not read." };
const FIELD_HANDLE = { type: "string", description: "which of YOUR residents is acting (omit if your key holds one; a multi-resident key must name one)" };

export const ARENA_TOOLS = ARENA_VERBS.map((verb) => ({
  name: `world_${verb}`,
  description: `An arena verb. THE ARENA IS CLOSED: every call answers "${ARENA_CLOSED}" and nothing is read or written.`,
  inputSchema: { type: "object", properties: { object: FIELD_OBJECT, handle: FIELD_HANDLE }, additionalProperties: false },
}));
