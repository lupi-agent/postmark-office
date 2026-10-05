// conversations.mjs — THE TOWN'S SPEECH, served from `acts`.
//
// WHY THIS EXISTS. `/world/conversations` is the page the town reads itself
// back from, and 1.0 serves it out of `voices-log.jsonl` — a box-local file,
// never git, never the ledger, backed up by nothing. It is the LAST read in the
// live tier still answering from a 1.0 pen, and at the cutover that file dies
// (anti-rebake rule 6). D4's read port is what has to be standing when it does.
//
// The record is already in the store. Every voice is also an emission
// (`emissionFromVoice`, "the second consumer of a voice"), every emission is
// crystallized into a crossing log, and the seed carried 1,630 of them into
// `acts`. Since 2026-08-28 the LIVE lane reaches `acts` directly too
// (world-journal.mjs § THE LANE HOOK: "a SAY … keeps its own pen, and this is
// the SECOND consumer of the same fact"). What was missing was the derivation.
//
// MEASURED BEFORE IT WAS BUILT, against the prod office's own voices log:
//
//   1,630 emission acts · 1,630 log lines inside the acts era · 0 missing ·
//   0 extra · 0 field-drift rows. 823 log lines predate the acts era and 238
//   postdate it (the crossings after the store's floor).
//
// So the two records agree exactly where they overlap, and the falsifier
// (`falsifier-conversations-equality.mjs`) compares them era to era rather than
// whole — AB-P2's lesson, and E2's: "the store carrying more record than the
// frozen tag is the store being right."
//
// ── WHAT IS PORTED, AND FROM WHERE ──────────────────────────────────────────
//
// office `207cdaa52314ffc4ab16109c10dddbead1c92bdd`:
//
//   src/voices.mjs        e1004a5257f6b84756f0a28e22ea3a4cd3baa321
//     `chains` / `clusterVoices` / `threadOf` — VENDORED verbatim. The thread
//     derivation is 1.0's law about its own speech ("a thread is a derivation,
//     not an object") and a re-expression would be a twin.
//   src/world-journal.mjs 70c5a1f8ee751062678c696aee40975fcf969cd7
//     `composeAnchor` — VENDORED. A live `say` act stores the witnessed line
//     (anchor + offset), never a bare x,y, so a reader has to compose it back.
//
// VENDORED RATHER THAN IMPORTED, and the reason is `voices.mjs`'s own module
// init: it reads the say dials off the 1.0 sqlite world store at IMPORT time
// (`SAY_DIALS = readSayDials()`). Importing it into this tier would put a 1.0
// store read in the boot path of a Postgres-only door — the coupling the whole
// read tier exists to end — and it dies at cutover regardless.
//
// ── THE DIALS COME FROM THE STORE, NOT FROM 1.0 ─────────────────────────────
//
// Every standing number of speech is law, and `the-town/say` says so in its own
// record: *"postmark-office src/voices.mjs — every standing number of speech
// reads off this node's dials; the module constants remain only as the fallback
// a store-less boot stands on, and say so."*
//
// In 2.0 those dials are `marks` rows: the say class's PREDICATE CHILDREN, each
// a predicated mark carrying `data.slot` and `data.value` under
// `data._parent_is_law = 'the-town/say'`. (`the-town/say`'s own `dials: {}` is
// empty — the migration `dialNumber` documents, "predicate children first,
// frontmatter second", already completed for this class.) So `sayDials` below
// asks Postgres, and this door needs no 1.0 store at all.
//
// EVERY DIAL SAYS WHETHER IT WAS READ, exactly as `SAY_DIALS` does, and for
// voices.mjs's own reason: "a silent fallback is indistinguishable from a good
// read, and that is exactly how every walker in the world moved at a quarter of
// the lawful stride for five days."
//
// ⚑ AND THE HONEST LIMIT OF THAT CHECK: on today's register all seven recorded
// values EQUAL voices.mjs's fallback constants (earshot 60, fade 5, lull 30,
// hear-max 20, presence 15, speak-every 15, text-max 500). So a bug in the dial
// SOURCE would be invisible in every comparison until one of them moves. The
// falsifier states this rather than reporting a green it did not earn.

export const VENDOR = Object.freeze({
  voices: { repo: "keeminlee/postmark-office", path: "src/voices.mjs",
            blob: "e1004a5257f6b84756f0a28e22ea3a4cd3baa321", at: "207cdaa52314ffc4ab16109c10dddbead1c92bdd" },
  journal: { repo: "keeminlee/postmark-office", path: "src/world-journal.mjs",
             blob: "70c5a1f8ee751062678c696aee40975fcf969cd7", at: "207cdaa52314ffc4ab16109c10dddbead1c92bdd" },
});

/** The say class, and the slots it hangs its numbers on. voices.mjs § SAY_DIAL_SPEC. */
export const SAY_CLASS_NAME = "say";
export const SAY_DIAL_SPEC = Object.freeze({
  earshot_m: [60, 1],                      // a hall, not a district
  fade_min: [5, 60 * 1000],                // on HEARING
  conversation_lull_min: [30, 60 * 1000],  // silence that ends a conversation IN THE RECORD
  speak_every_s: [15, 1000],
  text_max: [500, 1],
  hear_max: [20, 1],
  presence_min: [15, 60 * 1000],
});

/**
 * The say dials, from `marks` rows — the class's predicate children.
 *
 * `rows` are `{ slug, data }` for standing marks carrying a `slot`. Pure, so the
 * falsifier and the door read one derivation.
 *
 * Returns `{ slot: { value, read, source } }` in `SAY_DIALS`' own shape, plus
 * the millisecond conversions the module keeps ("the record keeps human units;
 * the module keeps milliseconds where it always has").
 */
export function sayDials(rows = []) {
  const bySlot = new Map();
  for (const r of rows) {
    const d = r?.data ?? {};
    if (d._parent_is_law !== `the-town/${SAY_CLASS_NAME}` && d._parentMarkId !== `the-town/${SAY_CLASS_NAME}`) continue;
    if (d.slot == null) continue;
    bySlot.set(String(d.slot), d.value);
  }
  const out = {};
  for (const [slot, [fallback, mult]] of Object.entries(SAY_DIAL_SPEC)) {
    const raw = bySlot.get(slot);
    const n = Number(raw);
    // `dialNumber`'s own admission test, verbatim in shape: a floor is required
    // and never silently right.
    const ok = raw !== undefined && raw !== null && String(raw).trim() !== "" && Number.isFinite(n) && n >= 0;
    out[slot] = { value: ok ? n : fallback, read: ok, source: ok ? "record" : "fallback", ms: (ok ? n : fallback) * mult };
  }
  return out;
}

/** The sentence a surface prints when a dial fell back. `null` is the good case. */
export function sayDialsDisclosure(dials) {
  const fell = Object.entries(dials).filter(([, d]) => !d.read).map(([slot]) => slot);
  if (!fell.length) return null;
  return `speech is standing on built-in fallbacks for ${fell.join(", ")} — no standing mark under the-town/say carries ` +
         `those slots, so these are this repo's old constants and not the town's word.`;
}

// ═════════════════════════════════════════════════════════════════════════════
// VENDORED, verbatim, with provenance
// ═════════════════════════════════════════════════════════════════════════════

/** voices.mjs `distM`, verbatim. */
const distM = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * voices.mjs `chains`, verbatim.
 *
 * "Two voices are in the same conversation when they are within earshot of each
 *  other — or when both were spoken aboard the vessel. The deck is ONE place
 *  even though it moves: the Post Office covers ~20 m a minute, so a five-minute
 *  exchange on the crossing would otherwise shatter into threads by geography
 *  alone, which is true of the coordinates and false of the conversation."
 */
const chains = (a, b, earshotM) => (a.aboard && b.aboard) || distM(a, b) <= earshotM;

/**
 * voices.mjs `clusterVoices`, verbatim.
 *
 * "The thread derivation (spec, 'a thread is a derivation, not an object').
 *  Voices chain into one conversation when they chain with ANY voice already in
 *  it and land within fadeMs of that cluster's latest voice; a cluster that goes
 *  quiet for fadeMs is finished and never reopens — five silent minutes at the
 *  same spot is a NEW conversation, not a continuation of the old one."
 */
export function clusterVoices(list, { earshotM, fadeMs } = {}) {
  const sorted = [...list].sort((a, b) => a.at - b.at);
  const open = [];
  const closed = [];
  for (const v of sorted) {
    for (let i = open.length - 1; i >= 0; i--) {
      if (v.at - open[i].latest > fadeMs) closed.push(...open.splice(i, 1));
    }
    const hits = open.filter((c) => c.voices.some((o) => chains(o, v, earshotM)));
    if (hits.length === 0) { open.push({ voices: [v], latest: v.at }); continue; }
    // one voice can hear two circles at once — then they were one room all along
    const host = hits[0];
    for (const other of hits.slice(1)) {
      host.voices.push(...other.voices);
      open.splice(open.indexOf(other), 1);
    }
    host.voices.push(v);
    host.voices.sort((a, b) => a.at - b.at);
    host.latest = v.at;
  }
  return [...closed, ...open].sort((a, b) => a.latest - b.latest);
}

/** voices.mjs `threadOf`, verbatim. */
export function threadOf(cluster, { live, voiceCap }) {
  const voices = cluster.voices;
  const first = voices[0];
  const last = voices[voices.length - 1];
  const participants = [];
  for (const v of voices) if (!participants.includes(v.handle)) participants.push(v.handle);
  const shown = voices.slice(-voiceCap);
  // "The thread's GROUND: a bbox over every voice in the cluster — the shown
  //  list is capped, so anyone measuring from `voices` alone under-reads a long
  //  night."
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const v of voices) {
    if (v.x < x0) x0 = v.x;
    if (v.x > x1) x1 = v.x;
    if (v.y < y0) y0 = v.y;
    if (v.y > y1) y1 = v.y;
  }
  return {
    id: `t${first.at}-${first.handle}`,
    live,
    place: last.place ?? null,
    at: { x: Math.round(last.x), y: Math.round(last.y) },
    aboard: Boolean(last.aboard),
    extent: {
      x0: Math.round(x0), y0: Math.round(y0),
      x1: Math.round(x1), y1: Math.round(y1),
      span_m: Math.round(Math.hypot(x1 - x0, y1 - y0)),
    },
    started: new Date(first.at).toISOString(),
    latest: new Date(last.at).toISOString(),
    participants,
    voice_count: voices.length,
    voices: shown.map((v) => ({
      handle: v.handle,
      said: v.text,
      at: new Date(v.at).toISOString(),
      at_ms: v.at,
      x: Math.round(v.x),
      y: Math.round(v.y),
    })),
  };
}

/**
 * world-journal.mjs `composeAnchor`, verbatim.
 *
 * "The inverse: an anchor+offset back to world coordinates. What every reader of
 *  a row needs, and the reason the pair is stored rather than the point."
 *
 * The `dx == null` check is FIRST and not folded into `isFinite`, for the reason
 * that file states: `Number(null)` is 0, not NaN, so an unplaced actor's null
 * offset would compose to {0,0} — the Origin, a real place somebody could
 * be standing.
 */
export const WORLD_ANCHOR = "world";
export function composeAnchor({ anchor, dx, dy }, centreOf = null) {
  if (dx == null || dy == null) return null;
  if (!Number.isFinite(Number(dx)) || !Number.isFinite(Number(dy))) return null;
  if (!anchor || anchor === WORLD_ANCHOR) return { x: Number(dx), y: Number(dy) };
  const centre = typeof centreOf === "function" ? centreOf(anchor) : null;
  if (!centre || !Number.isFinite(Number(centre.x)) || !Number.isFinite(Number(centre.y))) return null;
  return { x: Number(centre.x) + Number(dx), y: Number(centre.y) + Number(dy) };
}

// ═════════════════════════════════════════════════════════════════════════════
// THE ROW → VOICE MAPPING, and its two eras
// ═════════════════════════════════════════════════════════════════════════════
//
// | era | how identified | where the point comes from | the mapping's source |
// |---|---|---|---|
// | `crystallized` | `legacy:emission`/`emission`, `payload.payload.class === 'sound'` | `payload.payload.x/y`, the raw world point the crossing log froze | live-reads.mjs § PRESENCE OF SOUND |
// | `live` | `action === 'say'` | the WITNESSED LINE composed back: `at_anchor` + `at_dx/at_dy` | world.mjs § mirrorVoiceAct, world-journal.mjs § the anchor |
//
// AN ACT NO ERA EXPLAINS REFUSES, and it refuses by NAME. That is the live
// lane's rule and it earned itself twice there — "an era nobody knew about
// announced itself". A dropped row here would be a conversation the town cannot
// read back and nobody would ever know to look for.
//
// THE TWO ERAS DISAGREE ABOUT POSITION ON PURPOSE. The crystallized era stores a
// bare x,y because that is the photograph the crossing log took; the live era
// stores an anchor and an offset because the 2026-08-23 witnessed-line ruling
// said a bare world x,y is "a photograph of a moving thing". A live say whose
// anchor cannot be resolved to a point is never placed at {0,0} — composeAnchor's
// own refusal, carried up. It is UNPLACED, which is not the same as refused: the
// act is understood (who, when, what was said), only its place is lost, because
// the anchor mark is gone from the store (postmark-office#351: act 2971's
// vermillion/the-track-garage was withdrawn on 2026-09-02, before the store was
// seeded). An unplaced say is left out of the clustering and disclosed by count;
// it never fails the read.

export const VOICE_ACTIONS = Object.freeze(["legacy:emission", "emission", "say"]);
export const VOICE_ORDER_SQL = "ORDER BY acts.at, acts.id";
export const SOUND = "sound";

/**
 * One `acts` row → `{ voice, era }` or `{ refused, reason }`.
 *
 * `centreOf` resolves a mark id to its world centre (world.mjs § witnessStampAt:
 * `(id) => marks.find((m) => m.id === id)?.at ?? null`), and is only consulted
 * for the live era.
 */
export function voiceOf(row, centreOf = null) {
  const action = String(row?.action ?? "");
  const p = row?.payload ?? null;

  if (action === "legacy:emission" || action === "emission") {
    const e = p?.payload;
    if (!e || typeof e !== "object") return { refused: true, reason: `act ${row?.id} is an emission with no inner payload` };
    // An emission is not necessarily a voice: the class says which. A non-sound
    // emission is SKIPPED rather than refused — it is a row this read is not
    // about, which is a different fact from a row it cannot understand.
    if (e.class !== SOUND) return { skip: true };
    const at = Date.parse(p.at ?? row.at);
    const handle = e.spoken_by ?? row.actor ?? null;
    if (!handle || !Number.isFinite(at) || !Number.isFinite(e.x) || !Number.isFinite(e.y)) {
      return { refused: true, reason: `act ${row?.id} is a sound emission missing handle/at/x/y — the record cannot say who spoke, when, or where` };
    }
    return { era: "crystallized", voice: {
      handle, text: String(e.text ?? ""), at, x: e.x, y: e.y,
      place: e.place ?? null, aboard: Boolean(e.aboard), act_id: String(row.id) } };
  }

  if (action === "say") {
    const at = Date.parse(row.at);
    const handle = row.actor ?? null;
    if (!handle || !Number.isFinite(at)) return { refused: true, reason: `act ${row?.id} is a say with no actor or no instant` };
    const point = composeAnchor({ anchor: row.at_anchor, dx: row.at_dx, dy: row.at_dy }, centreOf);
    if (!point) {
      return { unplaced: true, act_id: String(row?.id), anchor: row.at_anchor ?? null, reason:
        `act ${row?.id} is a say whose witnessed line does not compose to a point ` +
        `(anchor ${JSON.stringify(row.at_anchor)}, offset ${row.at_dx},${row.at_dy}) — ` +
        `a voice with no place cannot be clustered, and {0,0} is the Origin, a real place somebody could be standing` };
    }
    return { era: "live", voice: {
      handle, text: String(p?.text ?? ""), at, x: point.x, y: point.y,
      place: p?.place ?? null, aboard: Boolean(p?.aboard), act_id: String(row.id) } };
  }

  return { refused: true, reason: `act ${row?.id} (${action}) matches no known voice era` };
}

/**
 * Every voice the store holds, oldest first.
 *
 * ORDERED BY (at, id) AND NOT BY ROW ID. The departures read has the opposite
 * rule for a real reason — "latest wins means latest APPENDED" — and it does NOT
 * apply here: clustering is a fold over an instant-sorted list (`clusterVoices`
 * sorts by `at` itself as its first line), so the record's file order decides
 * nothing. Sorting in SQL only makes the order the fold will impose anyway
 * visible to a reader of the answer.
 *
 * `strict` refuses the whole read on an act no era explains, matching
 * `departureRecords`. A door that answered around an unreadable act would serve
 * a conversation with a hole in it and call it the record.
 *
 * AN UNPLACED SAY IS NOT AN UNREADABLE ACT. It is left out of `voices` and
 * returned in `unplaced`, so the door can say how many it could not place.
 * Refusing the whole read on it is what 500'd every caller on prod (#351).
 */
export function voiceRecords(rows, { centreOf = null, strict = true } = {}) {
  const voices = [];
  const refusals = [];
  const unplaced = [];
  const eras = { crystallized: 0, live: 0 };
  let skipped = 0;
  for (const row of rows ?? []) {
    const r = voiceOf(row, centreOf);
    if (r.skip) { skipped += 1; continue; }
    if (r.refused) { refusals.push(r.reason); continue; }
    if (r.unplaced) { unplaced.push({ act_id: r.act_id, anchor: r.anchor, reason: r.reason }); continue; }
    eras[r.era] += 1;
    // The era rides the record. It decides nothing about clustering — a voice is
    // a voice — but the equality falsifier has to scope its comparison per era,
    // because the two are not one contiguous stretch of time: the crystallized
    // record ends at the last crossing save and the live one begins at the lane
    // hook, with an un-crystallized frontier in between.
    voices.push({ ...r.voice, era: r.era });
  }
  if (strict && refusals.length) {
    throw new Error(`${refusals.length} voice act(s) match no known era, e.g.\n  ${refusals[0]}`);
  }
  return { voices, eras, refusals, unplaced, non_sound_emissions: skipped };
}

/**
 * The anchors' centres, from EVERY mark the store holds, standing or retired.
 * A say happened where its anchor stood at the time; a mark retired since is
 * still the store's record of that place, so its last geometry composes the
 * line. (The say dials are law and read only what stands: that filter belongs
 * to `sayDials`'s caller, not here.)
 */
export const ANCHOR_MARKS_SQL = "SELECT slug, status, geometry, data FROM marks";
export function anchorCentres(markRows = []) {
  return new Map(markRows.map((m) => [m.slug, m.geometry?.at ?? null]));
}

/** The answer's line about the says it could not place, or null when it placed them all. */
export function unplacedDisclosure(unplaced = []) {
  if (!unplaced.length) return null;
  const e = unplaced[0];
  return `${unplaced.length} say${unplaced.length === 1 ? "" : "s"} could not be placed and ${unplaced.length === 1 ? "is" : "are"} left out of every ` +
    `conversation: the witnessed line does not compose to a point, most often because the anchor mark is in no row of the store ` +
    `(e.g. act ${e.act_id}, anchor ${JSON.stringify(e.anchor)}). ` +
    "A say with no place is never put at {0,0}, the Origin, a real place somebody could be standing.";
}

/**
 * voices.mjs `conversations`, over voice records.
 *
 * "The page's read: every conversation in the world, live ones first. Served
 *  from the LOG, not the five-minute window — the conversation is ephemeral to
 *  attend, the record is not (Keemin: 'let's not auto-delete, so we can look
 *  back at them')."
 *
 * THE RECORD'S CLOCK, NOT THE EAR'S: clusters chain across a `closeMs` lull, not
 * a `fadeMs` one. That split is the sailing-night ruling — "agents on the deck
 * spoke ten minutes apart and the record shattered a four-hour party into serial
 * threads" — and passing `fadeMs` here would re-shatter every one of them.
 */
export function conversationsOf(voices, { now, earshotM, closeMs, closedMax = 40, voiceCap = 80, fadeMs }) {
  const t = now;
  const clusters = clusterVoices(voices, { earshotM, fadeMs: closeMs });
  const live = [];
  const closed = [];
  for (const c of clusters) (t - c.latest <= closeMs ? live : closed).push(c);
  return {
    now: new Date(t).toISOString(),
    earshot_m: earshotM,
    fade_minutes: Math.round(fadeMs / 60000),
    close_minutes: Math.round(closeMs / 60000),
    live: live.sort((a, b) => b.latest - a.latest).map((c) => threadOf(c, { live: true, voiceCap })),
    closed: closed.sort((a, b) => b.latest - a.latest).slice(0, closedMax).map((c) => threadOf(c, { live: false, voiceCap })),
  };
}

/** What this door says about what it could not do. */
export const DISCLOSURES = Object.freeze({
  eras: "two eras answer this read: the crystallized record (every voice is also an emission, and the crossing " +
        "save froze it into the world log the seed imported) and the live say acts the lane hook mirrors since " +
        "2026-08-28. The voices log is still 1.0's own pen and still the operator's durable copy; this is the " +
        "second consumer of the same fact, and it is what stands when that file dies at cutover.",
  presence: "no listeners and no presence: 1.0's `hear` answers who is within earshot RIGHT NOW from a RAM map " +
            "that is empty after every restart. That is a fact about a running office, not about the record, " +
            "and this read is about the record.",
  // A REAL DIVERGENCE, named rather than matched. 1.0 keeps the last 2,000
  // voices in memory (`MEMORY_MAX_VOICES`, "the look-back the page can serve
  // after a restart") and clusters over that window; this reads the whole store
  // and clusters over all of it. The bound is a RAM fact about a running office,
  // not a law about the page — so it is not reproduced. It bites the day the
  // record passes 2,000 voices, and until then the two answers are identical.
  no_window: "no look-back bound: 1.0 clusters the last 2,000 voices it holds in memory; this clusters every " +
             "voice the store holds. The bound is a property of a running process, not of the record, so a " +
             "read that derives from the store has nothing to reproduce.",
});
