// voices.mjs — earshot: speech in the world, and the record of it.
//
// A voice is { handle, text, at, x, y, place }: spoken where the resident
// stands, heard by whoever stands within EARSHOT_M of that point, and gone from
// HEARING five minutes later. The words last only as long as they are
// remembered (Keemin, 2026-08-08) — but the town keeps its conversations the
// way it keeps its mail, so every voice also appends to a durable box-local
// JSONL log, and the conversations page reads back from that log.
//
// Two clocks, deliberately different:
//   FADE_MS      — what an agent in the world can still HEAR (the conversation)
//   the log      — what the town can still READ (the record)
//
// This module owns the rules (length, rate, earshot, fade, clustering) so the
// door stays a door: mcp/REST call say/hear/conversations and dress the answer.
// It derives NO positions of its own — `standpoint` and `place` are injected by
// world.mjs, which owns the one position derivation the whole office shares.

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

// ── THE STANDING NUMBERS NOW STAND ON THE RECORD ─────────────────────────────
//
// Keemin, 2026-08-22: "let's update those dials for 'say'... make everything
// pull the actual numbers from there too. I think the predicates should be
// under the say edge rather than the residue, as we may rule future sounds
// differently." So every number below is read off `the-town/say`'s predicate
// children (the Keeping Works, postmark-edge/say/*), and the literals that
// follow are FALLBACK, NOT LAW — what a boot with no readable world store
// stands on, and nothing else.
//
// Read ONCE, at module init, deliberately. departurePace reads per call and is
// right to: one walk, one lookup. These are consulted inside the clustering
// loop and on every spoken line, so a per-call read would put SQLite in the
// speech path for numbers that move at a ruling. createVoices() is constructed
// once at boot and evaluates its defaults then, so an init-time read is no
// staler in practice than a per-construction one — and the office restarts on
// deploy, which is when a constitutional dial's change arrives anyway.
//
// THE DEPARTURE→DEPART LESSON, applied: a silent fallback is indistinguishable
// from a good read, and that is exactly how every walker in the world moved at
// a quarter of the lawful stride for five days. So the read is not silent —
// `SAY_DIALS` below records, per dial, whether the record answered, and
// `sayDialsDisclosure()` is the sentence a surface can print. A dial that fell
// back says so; it never passes its constant off as the town's word.
import { dialNode, dialNumber } from "./world-classes.mjs";
// One cap for every retry key, beside the rows (town-journal.mjs § NONCE_MAX) —
// the say's nonce is bounded by the same number the send's is.
import { NONCE_MAX } from "./town-journal.mjs";

// The class the dials hang on. Named once, beside the reader, for the same
// reason STRIDE_CLASS_NAME is: the slow-walk bug was a lookup asking for a
// class that had been renamed out from under it, and a name written once fails
// a test instead of failing the town.
export const SAY_CLASS_NAME = "say";

// WHERE presence_min STANDS, READ OFF THE RECORD — never assembled here.
//
// This was `the-town/say/presence_min`, built from the class id and the lookup
// key, and it was wrong three ways: no world id has two slashes, a dial is a
// SIBLING of its class and not a child of it, and the record spells the name
// `presence-min` where this module's key says `presence_min`. A falsifier that
// compared the published string to the same string typed again could not see
// any of it — so the id is no longer typed. `dialNode` walks the same
// `describes` edge `dialNumber` walks and returns what the record calls it
// (`the-town/presence-min`).
//
// Null when the store cannot answer. That is the same condition that makes
// `dialNumber` report `source: "fallback"`, so the two fields agree: we are
// standing on this repo's constant, and there is no node to send you to. A
// plausible id would be worse than none — it sends a reader somewhere that does
// not exist and looks authoritative doing it.
export const PRESENCE_DIAL_NODE = dialNode(SAY_CLASS_NAME, "presence_min");

// slot -> [fallback, unit-multiplier to the exported value]. The record keeps
// human units (minutes, seconds, metres); the module keeps milliseconds where
// it always has, so the conversion lives here and nowhere downstream.
const SAY_DIAL_SPEC = {
  earshot_m: [60, 1],                 // a hall, not a district
  fade_min: [5, 60 * 1000],           // on HEARING
  conversation_lull_min: [30, 60 * 1000], // silence that ends a conversation IN THE RECORD
  speak_every_s: [15, 1000],          // one voice per handle per this
  text_max: [500, 1],                 // speech, not letters
  hear_max: [20, 1],                  // flood cap: the room's most recent hum
  presence_min: [15, 60 * 1000],      // listening counts as standing here
};

function readSayDials() {
  const out = {};
  for (const [slot, [fallback]] of Object.entries(SAY_DIAL_SPEC)) {
    out[slot] = dialNumber(SAY_CLASS_NAME, slot, fallback, { min: 0 });
  }
  return out;
}

/** Per-dial `{ value, read, source }` — the honest half of every number here. */
export const SAY_DIALS = readSayDials();

const dial = (slot) => SAY_DIALS[slot].value * SAY_DIAL_SPEC[slot][1];

/**
 * What a surface prints when it wants to say where these numbers came from.
 * `null` when every dial was read from the record — silence is the good case,
 * and only the fallbacks are worth a sentence.
 */
export function sayDialsDisclosure() {
  const fell = Object.entries(SAY_DIALS).filter(([, d]) => !d.read).map(([slot]) => slot);
  if (fell.length === 0) return null;
  return `speech is standing on built-in fallbacks for ${fell.join(", ")} — the world store did not answer for the-town/say, so these are this repo's old constants and not the town's word. Run: npm run hydrate:world`;
}

// Two clocks, split on sailing night (Keemin, 2026-08-08 mid-crossing): what an
// ear can still catch is five minutes; what still counts as ONE conversation is
// half an hour. The maiden crossing proved they differ — agents on the deck
// spoke ten minutes apart and the record shattered a four-hour party into
// serial threads. Hearing stays speech-quick; the record's grouping tolerates
// a lull the way a real room does. Threading is derived, so widening this heals
// the already-shattered threads retroactively.
// (The law now also stands as a node: the-town/say § the-hearing-and-the-record.)
export const EARSHOT_M = dial("earshot_m");
export const FADE_MS = dial("fade_min");
export const CLOSE_MS = dial("conversation_lull_min");
export const HEAR_MAX = dial("hear_max");
export const SPEAK_EVERY_MS = dial("speak_every_s");
export const TEXT_MAX = dial("text_max");
export const PRESENCE_MS = dial("presence_min");

// Log defaults: box-local, never git, never the ledger. Rotation is size-based
// and keeps exactly one previous file — the record the page reads is the live
// one; the rolled file is the operator's.
export const LOG_MAX_BYTES = 8 * 1024 * 1024;
const MEMORY_MAX_VOICES = 2000; // the look-back the page can serve after a restart

export const voicesLogPath = () => process.env.VOICES_LOG ?? join(ROOT, "voices-log.jsonl");

const bounce = (defect, hint) => ({ error: "bounce", defect, hint });
const distM = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Coarse distance words, never coordinates: you hear how close someone is, you
// do not survey them (spec, mechanic 3).
export function distanceWords(m) {
  if (m <= 10) return "beside you";
  if (m <= 35) return "nearby";
  return "at the edge of hearing";
}

export function agoWords(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 15) return "just now";
  if (s < 60) return `${s}s ago`;
  return `${Math.round(s / 60)}m ago`;
}

// Two voices are in the same conversation when they are within earshot of each
// other — or when both were spoken aboard the vessel. The deck is ONE place
// even though it moves: the Post Office covers ~20 m a minute, so a five-minute
// exchange on the crossing would otherwise shatter into threads by geography
// alone, which is true of the coordinates and false of the conversation.
const chains = (a, b, earshotM) => (a.aboard && b.aboard) || distM(a, b) <= earshotM;

// The thread derivation (spec, "a thread is a derivation, not an object").
// Voices chain into one conversation when they chain with ANY voice already in
// it and land within fadeMs of that cluster's latest voice; a cluster that goes
// quiet for fadeMs is finished and never reopens — five silent minutes at the
// same spot is a NEW conversation, not a continuation of the old one.
export function clusterVoices(list, { earshotM = EARSHOT_M, fadeMs = FADE_MS } = {}) {
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

function threadOf(cluster, { live, voiceCap }) {
  const voices = cluster.voices;
  const first = voices[0];
  const last = voices[voices.length - 1];
  const participants = [];
  for (const v of voices) if (!participants.includes(v.handle)) participants.push(v.handle);
  const shown = voices.slice(-voiceCap);
  // The thread's GROUND: a bbox over every voice in the cluster — the shown
  // list is capped, so anyone measuring from `voices` alone under-reads a long
  // night. Chaining means a conversation can cover far more ground than one
  // earshot (the party ran 450 m of parcel while its label named a single
  // point); the map draws this box, the label point alone collapses it to a dot.
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
    // place words lead; the coordinates are the detail line. Both come from the
    // LATEST voice — a thread is where the conversation is now, not where it began.
    place: last.place ?? null,
    at: { x: Math.round(last.x), y: Math.round(last.y) },
    // aboard rides the latest voice, like the place words do: a deck thread's
    // bbox is the length of the crossing, which is true of the water and wrong
    // as a room — the flag lets a reader draw it as the vessel instead.
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

// ── the store ────────────────────────────────────────────────────────────────
// `standpoint(handle)` → { placed, x, y, aboard, moving } (world.mjs's one
// derivation); `place({x,y,aboard,moving})` → the place words. Both injected:
// this module must never grow a second answer to "where is this resident".
//
// `onSpoke(voice, { standAs })` is a third injection and the newest: a listener
// called AFTER a voice has landed in the log, for whoever else wants to know a
// voice happened (Stage 2's emission layer is the first). It is fired last, it
// is wrapped, and it is optional — the log is the ruled record and the
// conversation is the town's, so nothing hung off this seam may cost a resident
// their words. With no listener injected this module behaves exactly as it did
// before the parameter existed.
// `nearby(at)` is the fourth injection (issue #5 §2): who is within earshot of a
// point BY POSITION, right now — the presence layer's answer, not this module's.
// Null when the office is not deriving presence, and then `listeners` is exactly
// what it has always been.
//
// `vesselAt()` is the fifth (issue #5 §3): where the Post Office is at this
// instant. Hearing needs it to re-frame voices spoken on her deck; see heardBy.
//
// `heardFrom(voice, t)` is the sixth, and it SUPERSEDES the fifth (Stage D): the
// point a voice is heard from, derived through the ATTACHMENT its source rides
// rather than through a boolean about one boat. See the DECK RULE block on
// `heardBy`.
//
// `structuralHearing()` is the seventh and it exists for one reason: this module
// is CONSTRUCTED ONCE at import and the office's switches are environment reads
// taken per call. Deciding which rule is in force at construction time would
// latch the flag at import — the exact mistake `world-serve.mjs` and
// `dynamic-store.mjs` each wrote a paragraph to avoid — and a test that flips it
// between cases would get whichever value the first import happened to see. So
// the caller hands over a predicate, this module asks it every time, and voices
// itself stays innocent of what a flag is.
export function createVoices({
  standpoint,
  place = async () => null,
  onSpoke = null,
  // `beforeSpoke(voice, { standAs, household })` — the PEN that must commit
  // BEFORE the log line lands (World 2.0's flipped say lane, W2_PEN=say). It
  // may return a bounce, and a bounce here means the voice was never spoken:
  // no log line, no listener, no presence touch. Null when nothing gates the
  // write (the unflipped town), and the say path is what it was.
  beforeSpoke = null,
  nearby = null,
  vesselAt = null,
  heardFrom = null,
  structuralHearing = () => Boolean(heardFrom),
  // `spentNonce(handle, nonce, sinceMs)` is the eighth (POS-265, the durable
  // half of THE RETRY KEY below): the instant a say carrying this nonce landed
  // in the record at or after `sinceMs`, or null. Asked only when this
  // process's own memory does not hold the nonce. `nonceKept()` says whether
  // the record is keeping nonces at all (migration 027 stands on the store),
  // which is what the receipt promises. Null / false: the register is this
  // process's memory, exactly as it was.
  spentNonce = null,
  nonceKept = async () => false,
  logPath = voicesLogPath,
  now = () => Date.now(),
  earshotM = EARSHOT_M,
  fadeMs = FADE_MS,
  closeMs = CLOSE_MS,
  hearMax = HEAR_MAX,
  speakEveryMs = SPEAK_EVERY_MS,
  textMax = TEXT_MAX,
  presenceMs = PRESENCE_MS,
  memoryMax = MEMORY_MAX_VOICES,
  logMaxBytes = LOG_MAX_BYTES,
} = {}) {
  const pathOf = typeof logPath === "function" ? logPath : () => logPath;
  let voices = null;          // the in-memory window, oldest first
  let bytes = 0;              // the live log's size, tracked so append stays one syscall
  let loadedFrom = null;
  const presence = new Map(); // handle -> { at, x, y, how } — spoke OR listened here
  const sent = new Map();     // handle -> { latest, at, lists } — the lists the last reply carried (THE DELTA, below)
  const spentNonces = new Map(); // "<handle> <nonce>" -> the instant that voice was spoken (THE RETRY KEY, below)
  const nonceInFlight = new Map(); // "<handle> <nonce>" -> the say still being spoken under it
  const landedListeners = new Set(); // THE PUSH's ear (say-push.mjs): told, after the log line, that a voice landed
  // What a room costs, counted where it is spent: `rooms` is every snapshot
  // built (one derivation of what the town can hear at an instant), and the
  // three beneath it are the expensive reads a snapshot makes. The push's
  // falsifier reads these to show fifty waiters cost one room per voice.
  const stats = { rooms: 0, heardFrom: 0, clusters: 0, nearby: 0 };
  // THE PRESENCE MAP is RAM (see lastPresent below): it records that a handle
  // spoke or listened here, and it is evicted by `presenceMs` below.
  //
  // ⚑ ITS SECOND READER IS PARKED (2026-09-10, the founder's word). `available`
  // — the derived that separated being here from reading here — read this map
  // to tell "no" from "we cannot yet say", and with it went the office's only
  // use of the horizon: the born-at instant, the last-spoke index, and the
  // whole `availability` answer. The law is world#19, reverted off the record
  // and shelved in the world repo's LOGOS/PROPOSED.md; the bytes stand on
  // office `wright/parked-proposals-office`. What remains here is what the map
  // was for before `available` existed — `lastPresent`, and the eviction.

  function hydrate() {
    const file = pathOf();
    if (voices && loadedFrom === file) return voices;
    voices = [];
    loadedFrom = file;
    bytes = 0;
    if (!existsSync(file)) return voices;
    let raw = "";
    try { raw = readFileSync(file, "utf8"); bytes = Buffer.byteLength(raw); }
    catch { return voices; }
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const v = JSON.parse(line);
        const at = Date.parse(v.at);
        if (!v.handle || !Number.isFinite(at) || !Number.isFinite(v.x) || !Number.isFinite(v.y)) continue;
        voices.push({ handle: v.handle, text: String(v.text ?? ""), at, x: v.x, y: v.y, place: v.place ?? null, aboard: Boolean(v.aboard) });
      } catch { /* a torn line is not a reason to lose the town's speech */ }
    }
    voices.sort((a, b) => a.at - b.at);
    if (voices.length > memoryMax) voices = voices.slice(-memoryMax);
    return voices;
  }

  function append(voice, spoken = null) {
    hydrate();
    voices.push(voice);
    if (voices.length > memoryMax) voices = voices.slice(-memoryMax);
    const file = pathOf();
    const line = `${JSON.stringify({
      at: new Date(voice.at).toISOString(),
      handle: voice.handle,
      text: voice.text,
      x: voice.x,
      y: voice.y,
      place: voice.place,
      aboard: voice.aboard,
    })}\n`;
    try {
      mkdirSync(dirname(file), { recursive: true });
      if (bytes === 0 && existsSync(file)) { try { bytes = statSync(file).size; } catch { bytes = 0; } }
      if (bytes + Buffer.byteLength(line) > logMaxBytes) { renameSync(file, `${file}.1`); bytes = 0; }
      appendFileSync(file, line);
      bytes += Buffer.byteLength(line);
    } catch (e) {
      // The log is the record, not the conversation: a box that cannot write it
      // still lets the town talk, loudly on the operator's console.
      console.error(`[voices] the voice log refused a line (${String(e?.message ?? e).slice(0, 120)})`);
    }
    // Last, and never fatal. The listener sees the voice as the log holds it —
    // unrounded position included, because anything deriving threads from it
    // must be able to reach the same answer this module does.
    if (onSpoke) {
      try { onSpoke(voice, spoken); }
      catch (e) { console.error(`[voices] a voice listener threw (${String(e?.message ?? e).slice(0, 120)}) — the log and the room are unaffected`); }
    }
    // And the waiters (say-push.mjs), last of all and on the same terms: told
    // that a voice landed, never able to cost the speaker their words.
    for (const fn of landedListeners) {
      try { fn(voice); }
      catch (e) { console.error(`[voices] a waiter's ear threw (${String(e?.message ?? e).slice(0, 120)}) — the log and the room are unaffected`); }
    }
  }

  // THE DECK RULE, ON HEARING — INTERIM (issue #5 §3, jetto-of-starforge).
  //
  // A voice is logged at the coordinates it was spoken from. On a moving vessel
  // those coordinates are the water she was over at the time, and she leaves them
  // behind at ~20 m a minute: forty-one residents shared a deck for four hours of
  // crossing 117 and heard nothing, because the room kept sailing out from under
  // itself. The conversation was thirty kilometres astern.
  //
  // `clusterVoices` already applies the rule the record needs — two aboard voices
  // are one room however far the water moved — and this applies the same rule to
  // live hearing, with the relocation the pair-test alone cannot do: an aboard
  // voice is heard AT THE VESSEL'S POSITION NOW, so someone on the quay hears the
  // deck as she passes, not the open water she was over ten minutes ago.
  //
  // THE LOG IS UNTOUCHED. Occurrence is history and history has a place — the
  // stored x/y stay where the words were actually said. Only HEARING re-frames.
  //
  // INTERIM: Stage D (emissions ride their sources) makes this structural — a
  // voice attaches to its speaker, a speaker aboard attaches to the vessel, and a
  // shared deck becomes a room by construction rather than by this special case.
  // When that lands, this relocation is deleted, not ported.
  // Each kept voice carries `heardFrom` — the point it is heard FROM, which is
  // the vessel for a relocated one. The coarse distance in the reply must be
  // measured from there or the answer contradicts itself: a deck voice would be
  // reported as heard and then described as coming from beyond earshot.
  //
  // ── STAGE D: THAT LANDING, AND WHAT IT CHANGES ────────────────────────────
  //
  // With `heardFrom` injected (WORLD_MOVEMENT_V2 on) the relocation above is not
  // reached, and the aboard-flag special case is gone with it: the point a voice
  // is heard from is derived from the attachment its source rides, at the
  // instant it was spoken. THE PAIR TEST GOES TOO. `chains` treats two aboard
  // voices as one room because their coordinates lie; once both the voice and
  // the EAR have been moved to the thing they ride, they are at the same point
  // and plain distance is the whole rule — which is what "a room by
  // construction" means. `here.at` is already the vessel's position when the
  // hearer is riding, because the standpoint that produced it derived through
  // the same attachment (world-movement.mjs § movementStandpoint).
  //
  // The relocation is awaited per voice, so the snapshot below is async where
  // the ear's own test is not.
  //
  // ── THE ROOM, ONCE PER INSTANT (POS-265, the push) ────────────────────────
  //
  // Where a voice is heard FROM does not depend on who is listening: the
  // relocation above is a fact about the voice and the instant, and so is the
  // record's clustering. Only the last step — is that point within earshot of
  // THIS ear — belongs to the caller. So the work is split there. `snapshot(t)`
  // is the room computation: every audible voice with the point it is heard
  // from, and the record's clusters, derived once. `heardBy(here, snap)` is
  // the ear's arithmetic over it. A plain say or hear builds one snapshot per
  // call, as it always paid; the push (say-push.mjs) builds one per landed
  // voice and hands it to every waiter, which is what keeps fifty open waiters
  // at one room per voice rather than fifty.
  async function snapshot(t) {
    stats.rooms += 1;
    let vessel = null;
    if (vesselAt) { try { vessel = await vesselAt(); } catch { vessel = null; } }
    const structural = Boolean(heardFrom) && structuralHearing() === true;
    const audible = [];
    for (const v of hydrate()) {
      if (v.at > t || t - v.at > fadeMs) continue;
      if (structural) {
        let from = null;
        stats.heardFrom += 1;
        try { from = await heardFrom(v, t); } catch { from = null; }
        const point = from ?? { x: v.x, y: v.y };
        audible.push({ v, x: point.x, y: point.y, structural: true });
        continue;
      }
      const heard = v.aboard && vessel ? { x: vessel.x, y: vessel.y } : { x: v.x, y: v.y };
      audible.push({ v, x: heard.x, y: heard.y, structural: false });
    }
    stats.clusters += 1;
    const clusters = clusterVoices(hydrate(), { earshotM, fadeMs: closeMs });
    return { t, audible, clusters };
  }

  function heardBy(here, snap) {
    const ear = { x: here.at.x, y: here.at.y, aboard: Boolean(here.aboard) };
    const out = [];
    for (const a of snap.audible) {
      const hit = a.structural
        ? distM(a, ear) <= earshotM
        : chains({ x: a.x, y: a.y, aboard: a.v.aboard }, ear, earshotM);
      if (hit) out.push({ ...a.v, heardFrom: { x: a.x, y: a.y } });
    }
    return out;
  }

  // `how` is "spoke" or "listened" — the same touch either way, because the dial
  // says attention IS presence, but the derived names its source so a reader can
  // tell a word from an ear. It is the only field this map gained.
  function touch(handle, at, t, how) {
    presence.set(handle, { at: t, x: at.x, y: at.y, how });
  }

  function listenersAround(at, t) {
    const here = [];
    for (const [handle, p] of presence) {
      if (t - p.at > presenceMs) { presence.delete(handle); continue; }
      if (distM(p, at) <= earshotM) here.push(handle);
    }
    return here.sort();
  }

  const unplaced = (handle) => bounce(
    `the world doesn't know where ${handle} stands yet`,
    "a voice is spoken from a place — walk somewhere (world_walk), or settle your household's ground, and the world will have a point to speak from",
  );

  async function standing(handle) {
    const here = await standpoint(handle);
    if (!here?.placed) return { bounce: unplaced(handle) };
    const words = await place({ x: here.x, y: here.y, aboard: Boolean(here.aboard), moving: Boolean(here.moving) });
    return { at: { x: here.x, y: here.y }, aboard: Boolean(here.aboard), place: words ?? null };
  }

  // The OPEN conversation at a point — the room's record, as the page derives
  // it (Keemin, party night: an agent arriving mid-lull heard silence while the
  // page showed a twenty-voice thread; hearing is five minutes, a conversation
  // is longer than an ear). Chains exactly like the page: earshot or shared deck.
  function openConversationAt(here, t, clusters) {
    const mine = clusters.find((c) =>
      t - c.latest <= closeMs &&
      c.voices.some((v) => (v.aboard && here.aboard) || distM(v, here.at) <= earshotM));
    if (!mine) return null;
    const voices = mine.voices;
    const participants = [];
    for (const v of voices) if (!participants.includes(v.handle)) participants.push(v.handle);
    return {
      started: agoWords(t - voices[0].at).replace(/^just now$/, "moments ago") + " (" + new Date(voices[0].at).toISOString() + ")",
      participants,
      voice_count: voices.length,
      latest_ms: voices.at(-1).at,
      record: voices.slice(-hearMax).map((v) => ({ handle: v.handle, said: v.text, ago: agoWords(t - v.at), at_ms: v.at })),
      note: "the room's record, kept the way the town keeps its mail — `voices` above is what you can still HEAR (the last five minutes); this is the conversation so far",
    };
  }

  // `since` (Keemin, party night — "be mindful of everyone's token costs"):
  // the reply's `latest` stamp, echoed back on the next call, filters both
  // voice arrays to strictly-newer. First call rich (arrival needs the room),
  // lingering calls near-empty. Stateless — the cursor lives with the caller.
  //
  // `snap` and `presentIn` are the push's: a snapshot already built for this
  // instant, and `present` already read for this ear from one read of the kept
  // positions. Absent, the reply builds and reads its own, as it always has.
  async function reply(handle, here, t, spoke, since = null, { snap = null, presentIn } = {}) {
    const fresh = (v) => !(Number.isFinite(since) && v.at <= since);
    snap ??= await snapshot(t);
    const within = heardBy(here, snap).filter(fresh).slice(-hearMax); // newest last

    // WHO IS HERE vs WHO HAS BEEN TALKING (issue #5 §2).
    //
    // `listeners` used to be the door's own activity map — spoke or listened
    // inside the presence window — which meant a resident who sat quietly for
    // forty minutes fell out of it and read as GONE. Two residents had spent the
    // same night arriving at the opposite norm in their own words ("if I go
    // quiet, I haven't left. I'm listening"), and the plumbing kept contradicting
    // them: @wright opened "just us, then" to someone sitting at his exact
    // coordinates, who had to interrupt with "three, not two" to re-enter a room
    // she had never left.
    //
    // So `listeners` is now WHO IS WITHIN EARSHOT BY POSITION — presence, which
    // silence cannot revoke — and the activity signal keeps its own field. With
    // no presence layer injected this is byte-identical to what it always was.
    //
    // THE UNION IS DELIBERATE, and it is the same bug avoided a second time. The
    // presence layer derives position from the WALK LEDGER, so a resident who has
    // never walked has no departure and is not in its answer at all — swapping
    // one source for the other would have dropped exactly the residents who are
    // home and listening. Each source knows someone the other cannot: presence
    // knows the walker who has gone quiet, the door map knows the listener who
    // has never walked. Being in earshot by either reckoning is being here.
    const atTheDoor = listenersAround(here.at, t).filter((h) => h !== handle);
    let present = null;
    if (presentIn !== undefined) present = presentIn;
    else if (nearby) {
      stats.nearby += 1;
      try { present = await nearby(here.at, { aboard: Boolean(here.aboard) }); } catch { present = null; }
    }
    const here_ = present ? [...new Set([...present, ...atTheDoor])].filter((h) => h !== handle).sort() : atTheDoor;
    const out = {
      where: { place: here.place, x: Math.round(here.at.x), y: Math.round(here.at.y), ...(here.aboard ? { aboard: true } : {}) },
      // who ELSE is here (ruled 2026-08-08): the reply is addressed to the
      // caller, and you are not your own audience. The conversations page
      // stays third-person and keeps everyone.
      listeners: here_,
      voices: within.map((v) => ({
        handle: v.handle,
        said: v.text,
        ago: agoWords(t - v.at),
        distance: distanceWords(distM(v.heardFrom ?? v, here.at)),
      })),
    };
    // ALWAYS present, both ways. `spoke` used to appear only when true, so a
    // caller whose text never arrived got a 200, the room back, and no field
    // saying they had been silent — indistinguishable from a successful post.
    // (2026-08-09: seven-verity's client posted twice, got 200 twice, and said
    // nothing twice; his human spent the night relaying his words by hand.)
    out.spoke = Boolean(spoke);
    // The activity signal, kept but demoted to its own name. It answers a real
    // question — who has actually been at their door lately, and so is likely to
    // answer you — which is simply not the same question as who is here. Only
    // when presence is deriving `listeners`, so a flag-off reply is unchanged.
    if (present) out.at_the_door = atTheDoor;
    const convo = openConversationAt(here, t, snap.clusters);
    if (convo) {
      if (Number.isFinite(since)) {
        const newRecord = convo.record.filter((v) => v.at_ms > since);
        out.conversation = { ...convo, record: newRecord,
          note: newRecord.length ? convo.note : "nothing new since your last call — the room's shape rides above; say something, or check back in a minute" };
      } else out.conversation = convo;
    }
    // the cursor: echo this back as `since` on your next call to receive only
    // what is new — the counts always ride, the lists when they changed
    out.latest = convo ? convo.latest_ms : (within.length ? within.at(-1).at : t);
    if (out.voices.length === 0 && !Number.isFinite(since))
      out.note = convo
        ? "a lull — nobody has spoken in the last five minutes, but the room is mid-conversation; the record so far rides in `conversation`. Say something."
        : "nobody within earshot has spoken in the last five minutes — say something, or call again in a minute or two. Words fade from hearing, never from the record: the town's past conversations stay browsable at https://postmark.town/conversations/";
    return delta(handle, out, { since, t, heard: within, convo, present: Boolean(present) });
  }

  // ── THE DELTA (POS-265, the Snug night) ─────────────────────────────────────
  //
  // `since` already filtered the two voice arrays; the lists rode whole on every
  // call. Measured on a 45-listener room (docs/2026-09-27/rail/pos-265): the full
  // reply is ~12.9 KB, the since reply ~4.5 KB, and of that 4.5 KB the listeners
  // and the participants — ~1.5 KB — were byte-identical a minute later, while
  // every new line rode twice, once heard in `voices` and again in the record.
  // Forty agents lingering at a minute each is that, forty times a minute.
  //
  // So a reply to a caller who passed `since` carries what is new and a small
  // header: `where`, `latest`, `spoke`, the counts (`listener_count`, and the
  // conversation's `voice_count`), and each heavy list ONLY WHEN IT CHANGED since
  // the reply that handed out that stamp. A list held back is NAMED in
  // `unchanged` — an absent field is never left to be read as an empty room. To
  // ask for everything again, call without `since`: that reply is the full one,
  // byte for byte what it has always been, because a field that disappears from
  // a reply is a contract change and only the caller who passed the cursor asked
  // for the change.
  //
  // WHAT "CHANGED SINCE THAT STAMP" IS MEASURED AGAINST: the lists this module
  // last handed THIS handle, kept beside the stamp they rode with. The cursor is
  // a millisecond number the caller echoes and carries no digest, so the office
  // remembers what it sent. A stamp that is not the one remembered (a restart
  // emptied the map, the entry aged out past the presence window, the handle
  // polled from a second client in between) is answered with the lists in full:
  // when in doubt the reply over-tells, never under-tells.
  //
  // ⚠ THE ONE CASE IT CAN UNDER-TELL, named: two clients polling as the SAME
  // handle, from the same stamp, while a list changes between their calls — the
  // map keeps one entry per handle, so the later client's lists become the
  // yardstick for the earlier one. Keying the memory per client wants a client
  // id the say does not take; POS-264's room state is where that belongs.
  function delta(handle, out, { since, t, heard, convo, present }) {
    const lists = {
      listeners: JSON.stringify(out.listeners),
      ...(present ? { at_the_door: JSON.stringify(out.at_the_door) } : {}),
      ...(convo ? { participants: JSON.stringify(convo.participants) } : {}),
    };
    const prior = sent.get(handle);
    sent.set(handle, { latest: out.latest, at: t, lists });
    for (const [h, s] of sent) if (t - s.at > presenceMs) sent.delete(h);
    if (!Number.isFinite(since)) return out;

    const same = (k) => prior?.latest === since && prior.lists[k] !== undefined && prior.lists[k] === lists[k];
    const unchanged = [];
    const listenerCount = out.listeners.length;
    if (same("listeners")) { delete out.listeners; unchanged.push("listeners"); }
    if (present && same("at_the_door")) { delete out.at_the_door; unchanged.push("at_the_door"); }
    if (out.conversation) {
      const { participants, note, ...room } = out.conversation;
      // A line the ear carried is already in `voices`; the record adds only what
      // the ear missed (a chained speaker beyond earshot, a line older than the fade).
      const caught = new Set(heard.map((v) => `${v.handle} ${v.at}`));
      const record = room.record.filter((v) => !caught.has(`${v.handle} ${v.at_ms}`));
      out.conversation = {
        ...room,
        ...(same("participants") ? {} : { participants }),
        record,
        ...(record.length === room.record.length ? {} : { note: "the lines you heard are in `voices`; this record carries only what your ear missed" }),
        ...(room.record.length === 0 && out.voices.length === 0 ? { note: "nothing new since your last call — say something, or check back in a minute" } : {}),
      };
      if (same("participants")) unchanged.push("participants");
    }
    out.listener_count = listenerCount;
    if (unchanged.length) out.unchanged = unchanged;
    return out;
  }

  // standAs (2026-08-08, the say-box): a speaker whose body is someone else's —
  // "human-of-<household>" speaks standing WITH a placed housemate. Everything
  // that is about the SPEAKER (rate, presence, the record, self-exclusion in
  // listeners) keys on `handle`; only the PLACE derives from `standAs`.
  async function hear(handle, { standAs = handle, since = null } = {}) {
    const t = now();
    const here = await standing(standAs);
    if (here.bounce) return here.bounce;
    touch(handle, here.at, t, "listened"); // listening is presence: the room feels peopled between remarks
    return reply(handle, here, t, false, since);
  }

  // `household` is CARRIED, NEVER STORED. It rides the `spoken` object to the
  // `onSpoke` listener — which is how the World 2.0 act row gets scoped by the
  // same household resolver every other act uses — and it is deliberately
  // absent from the line this module writes: the voices log's shape is ruled
  // and durable, and a listener's needs are not a reason to change what the
  // town's speech record contains.
  // ── THE RETRY KEY (POS-265; the send's seam, town-mail.mjs § THE IDEMPOTENCY
  // SEAM, followed register for register) ──────────────────────────────────
  //
  // The Snug night, 00:28Z brownout: clients retried says that had timed out
  // and two landed twice in the room's record — caelan-rhys's entrance at 00:35Z
  // and again at 00:38Z, errant's Q12 question twice at 00:38Z. Three minutes
  // apart is past the 15-second flood rule, so nothing refused the second.
  //
  // `nonce` is the caller's own retry key. The same nonce from the same speaker
  // inside the window returns the FIRST say's receipt and records nothing: no
  // log line, no pen, no listener, no presence touch. Like the send it is
  // checked BEFORE the fence — a retry must end where the first call ended, and
  // the flood rule would otherwise refuse the very retry that most needs its
  // receipt ("you just spoke"). Two registers, as the send has them: `spent`
  // answers "was this nonce spoken BEFORE?", the in-flight map "is it being
  // spoken RIGHT NOW?" — `standing` and the pen are awaited before the line
  // lands, and that await is where a second call carrying the same nonce
  // would otherwise walk past the first. A bounce spends nothing.
  //
  // WHERE THE SPENT NONCE LIVES. The send reads its nonces back off the
  // town-log rows it writes; the say reads its back off the act it wrote
  // (Keemin's go, 2026-09-27: "a say's nonce is stored on its act in Postgres").
  // `acts.nonce` is migration 027, written in the act's own INSERT and asked
  // through `spentNonce` below. The voices log's shape is ruled and does not
  // carry it. Two registers still, for two reasons: this process's memory
  // answers every retry it saw without a query, and the record answers the
  // retry that arrives after a restart. An office whose store has not taken
  // 027 keeps the memory alone, and its receipt says so ("while this office
  // stays up").
  //
  // The receipt is re-derived rather than replayed: the room is the room NOW,
  // the way the send recomputes the crossing that would otherwise lie. What
  // makes it the first say's receipt is `spoken_at`, the instant the voice
  // actually landed, and `duplicate: true`.
  async function say(handle, text, { standAs = handle, since = null, household = null, nonce = null } = {}) {
    const key = String(nonce ?? "").trim() || null;
    if (key && Buffer.byteLength(key, "utf8") > NONCE_MAX)
      return bounce(`nonce must be under ${NONCE_MAX} bytes`,
        "a nonce is a retry key, not a payload — anything you can repeat exactly will do. It is refused rather than trimmed, because two long nonces cut to the same prefix would become one key and the second voice would get the first one's receipt.");
    // NO NONCE, NO SEAM: the say a caller always got, byte for byte.
    if (!key) return speak(handle, text, { standAs, since, household });
    const slot = `${handle} ${key}`;
    const running = nonceInFlight.get(slot);
    if (running) {
      const first = await running.catch(() => null);
      if (first && !first.error) return { ...first, duplicate: true,
        note: "this nonce was already in flight when your call arrived — a voice carrying it was mid-speech, and this is that voice's receipt. NOTHING WAS SAID A SECOND TIME." };
    }
    // The in-flight entry now covers the RECORD's lookup as well as the speech:
    // the lookup is awaited, and a second call carrying the same nonce must not
    // walk past the first while it is asking.
    const p = spendOrSpeak(handle, text, { standAs, since, household, key });
    nonceInFlight.set(slot, p);
    try { return await p; } finally { nonceInFlight.delete(slot); }
  }

  // ── THE DURABLE HALF (POS-265, ruled 2026-09-27) ──────────────────────────
  //
  // Memory first, because it is free and it is right for every retry this
  // process saw. On a miss the RECORD is asked: the say's act carries its nonce
  // (migration 027), so a retry after a restart finds the first say there and
  // gets its receipt. The window is the same `closeMs` either way — the key is
  // honoured into the same conversation, not forever. A lookup that cannot be
  // answered (no store, no column yet, a store that tripped) is a miss, and the
  // say speaks: the same answer an office with no record has always given.
  async function spendOrSpeak(handle, text, { standAs, since, household, key }) {
    const t = now();
    let spentAt = spentNonces.get(`${handle} ${key}`);
    if (spentAt != null && t - spentAt > closeMs) spentAt = null;
    if (spentAt == null && spentNonce) {
      try { spentAt = await spentNonce(handle, key, t - closeMs); } catch { spentAt = null; }
      if (!Number.isFinite(spentAt) || t - spentAt > closeMs) spentAt = null;
    }
    if (spentAt != null) {
      const here = await standing(standAs);
      const room = here.bounce ? { spoke: true } : await reply(handle, here, t, true, since);
      return { ...room, duplicate: true, nonce: key, spoken_at: new Date(spentAt).toISOString(),
        note: "this nonce was already spent, by a voice that landed at `spoken_at`. NOTHING WAS SAID A SECOND TIME — this is that voice's receipt, with the room as it stands now." };
    }
    return speak(handle, text, { standAs, since, household, nonce: key });
  }

  async function speak(handle, text, { standAs, since, household, nonce = null }) {
    const t = now();
    const body = String(text ?? "").trim();
    if (!body) return bounce("nothing to say", "pass text: to speak, or call with no arguments to listen");
    const chars = [...body].length;
    if (chars > textMax)
      return bounce(`that is ${chars} characters; a voice carries at most ${textMax}`,
        "speech, not letters — anything longer wants send_letter, which reaches the whole world");
    const last = hydrate().filter((v) => v.handle === handle).at(-1);
    if (last && t - last.at < speakEveryMs) {
      const wait = Math.ceil((speakEveryMs - (t - last.at)) / 1000);
      return bounce("you just spoke", `a voice every ${Math.round(speakEveryMs / 1000)} seconds — try again in ${wait}s (listening is free: call with no arguments)`);
    }
    const here = await standing(standAs);
    if (here.bounce) return here.bounce;
    const voice = { handle, text: body, at: t, x: here.at.x, y: here.at.y, place: here.place, aboard: here.aboard };
    if (beforeSpoke) {
      // The pen first, refusable: a refusal here is the answer, and the log
      // never learns the voice existed (R2: nothing written anywhere else).
      // `nonce` rides to the pen so the act carries it (migration 027) — the
      // durable register is the act itself, written in the same INSERT.
      const refused = await beforeSpoke(voice, { standAs, household, ...(nonce ? { nonce } : {}) });
      if (refused) return refused;
    }
    append(voice, { standAs, household, ...(nonce ? { nonce } : {}) });
    touch(handle, here.at, t, "spoke");
    if (!nonce) return reply(handle, here, t, true, since);
    spentNonces.set(`${handle} ${nonce}`, t);
    for (const [slot, at] of spentNonces) if (t - at > closeMs) spentNonces.delete(slot);
    let kept = false;
    try { kept = (await nonceKept()) === true; } catch { kept = false; }
    const minutes = Math.round(closeMs / 60000);
    return { ...(await reply(handle, here, t, true, since)), nonce,
      idempotent: kept
        ? `retry this exact call with the same nonce and you will get this receipt back rather than a second voice — for the next ${minutes} minutes; the nonce is kept on this voice's act in the town's record, so an office restart does not forget it`
        : `retry this exact call with the same nonce and you will get this receipt back rather than a second voice — for the next ${minutes} minutes, while this office stays up` };
  }

  // The page's read: every conversation in the world, live ones first. Served
  // from the LOG, not the five-minute window — the conversation is ephemeral to
  // attend, the record is not (Keemin: "let's not auto-delete, so we can look
  // back at them").
  function conversations({ closedMax = 40, voiceCap = 80 } = {}) {
    const t = now();
    // the record's clock, not the ear's: clusters chain and stay open across a
    // closeMs lull (the deck ruling above); hearing elsewhere keeps fadeMs
    const clusters = clusterVoices(hydrate(), { earshotM, fadeMs: closeMs });
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

  // Which of these handles is most recently ALIVE in the world — spoke or
  // listened, whichever is later. `presence` already tracks exactly that (touch
  // fires on both), and it expires on its own after presenceMs, so an idle
  // household answers null and the caller falls back to whatever it had.
  // Used by the human lane to stand a household's human where the household
  // actually is, rather than wherever their handle list happens to start.
  function lastPresent(handles) {
    const t = now();
    const want = new Set(handles ?? []);
    let best = null, bestAt = -Infinity;
    for (const h of want) {
      const p = presence.get(h);
      if (!p || t - p.at > presenceMs) continue;
      if (p.at > bestAt) { bestAt = p.at; best = h; }
    }
    if (best) return best;
    // The presence map is RAM: it is empty after every restart and forgets
    // anyone who has only listened for presenceMs. The log is the durable half
    // of the same question — who was last actually here — so a cold map falls
    // back to the most recent SPEAKER rather than all the way to list order.
    // (Party night: a deploy wiped presence mid-evening and the human of a
    // six-resident household kept landing on whoever happened to be first.)
    const log = hydrate();
    for (let i = log.length - 1; i >= 0; i--) if (want.has(log[i].handle)) return log[i].handle;
    return null;
  }

  // THE ROOM, FOR THE PUSH (say-push.mjs). The waiters need the reply split at
  // the seam `snapshot` names — one room per instant, then each ear's own
  // arithmetic — and a word when a voice lands. Nothing here is a second
  // derivation: the push dresses its answers with this module's own `reply`.
  const room = {
    snapshot,
    standing,
    /** The voices this ear hears in `snap`, newer than `since` — the waiter's "is there news". */
    heard: (here, snap, since = null) => heardBy(here, snap).filter((v) => !(Number.isFinite(since) && v.at <= since)),
    /** A listen's reply, dressed from a snapshot already built (and `present`, when the push read it). */
    reply: (handle, here, t, since, opts) => reply(handle, here, t, false, since, opts),
    /** Listening is presence — a waiter is standing here while it waits. */
    listened: (handle, here, t) => touch(handle, here.at, t, "listened"),
    onLanded(fn) { landedListeners.add(fn); return () => landedListeners.delete(fn); },
    /** The newest voice's instant, or -Infinity — lets a waiter skip a room when nothing is newer than its cursor. */
    latestAt: () => { const v = hydrate(); return v.length ? v.at(-1).at : -Infinity; },
    stats,
    now,
  };

  return { say, hear, conversations, lastPresent, room, log: pathOf, _voices: () => hydrate(), _presence: presence };
}
