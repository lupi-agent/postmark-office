// world-find.mjs — FIND A MARK BY NAME FROM ANYWHERE (Keemin 2026-09-26).
//
// The complaint: a resident cannot find a mark they are not near. The Snug
// Harbour's party night made it plain — the one place everyone was asked to
// come to could only be found by already standing beside it. `town { read:
// "search" }` covers letters and residents; nothing read a mark by its name.
//
// PURE over a published mark list, the reader's position and the timetable's
// stops. The door (`world.mjs § worldFind`) fetches those three and hands them
// here, so the ranking and the route are testable without a world clone.
//
// ⚑ PUBLISHED STATE ONLY. The list handed in is the fold of published main —
// the same state every world read answers from — so a draft, a refused mark or
// one withdrawn off the record is not in it and cannot be found. Nothing here
// filters for that; the source already has.
//
// ⚑ RESIDENT TEXT RIDES IN NAMED FIELDS. A mark's name is whatever its naming
// mark says, which a resident wrote. It is carried in `name` and never spoken
// inside the office's own sentences (`more_note`, `note`), which quote only the
// caller's own `q` and numbers.

import { stopsOfService, straightLineM } from "./world-ride.mjs";

export const FIND_CAP = 10;
export const FIND_MAX = 50;

const SMALL_WORDS = new Set(["the", "of", "at", "on", "by", "and", "a", "an", "in", "to"]);
// The same derivation `world.mjs § prettyName` uses for a mark with no naming
// mark: the slug, title-cased. Restated rather than exported because that one
// is private to the place-words fold; the two must agree and the test pins it.
export function prettyName(id) {
  const slug = String(id ?? "").split("/").at(-1) ?? "";
  return slug.split("-").map((word, i) =>
    i > 0 && SMALL_WORDS.has(word) ? word
      : i === 0 && word === "the" ? word
        : word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

const point = (p) => p != null && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y));
const placed = (m) => point(m?.at);
const norm = (s) => String(s ?? "").toLowerCase().trim();
// "snug harbour" and "snug-harbour" are one question.
const dashed = (s) => norm(s).replace(/\s+/g, "-");
// A leading article is not what anyone types first: "snug" starts "The Snug".
const bare = (s) => s.replace(/^the[\s-]+/, "");

/** The rung a mark sits on for this query, or null when it does not match.
 *  0 an exact id · 1 a name or slug that starts with q · 2 one that contains it. */
export function rungOf(mark, name, q) {
  const id = norm(mark.id), slug = norm(String(mark.id).split("/").at(-1));
  const n = norm(name), qn = norm(q), qd = dashed(q);
  if (id === qn) return 0;
  const faces = [n, slug];
  if (faces.some((f) => f.startsWith(qn) || f.startsWith(qd) || bare(f).startsWith(bare(qn)) || bare(f).startsWith(bare(qd)))) return 1;
  if (faces.some((f) => f.includes(qn) || f.includes(qd)) || id.includes(qd)) return 2;
  return null;
}

const nearest = (stops, p) => {
  let best = null;
  for (const s of stops) {
    const d = straightLineM(p, s.at);
    if (d != null && (best == null || d < best.distance_m)) best = { stop: s.markId, distance_m: Math.round(d) };
  }
  return best;
};

/** How to get from where the reader stands to where the mark stands.
 *  `walk` when the mark is no further than the reader's own nearest stop, or
 *  when one stop serves both ends; otherwise board at the stop nearest you and
 *  ride to: the stop nearest the mark. A spectator stands nowhere, so has no
 *  boarding stop — but is still told where to get off. */
export function routeTo(markAt, readerAt, stops, distanceM) {
  if (!stops.length) return { by: null, note: "no vehicle runs in this world — walk" };
  const alight = nearest(stops, markAt);
  if (!readerAt) return { by: null, board: null, alight, note: "a spectator stands nowhere — board at whichever stop is nearest you and ride to: the alight stop" };
  const board = nearest(stops, readerAt);
  if (board.stop === alight.stop || distanceM <= board.distance_m) return { by: "walk" };
  return { by: "ride", board, alight };
}

/**
 * Find marks whose name, slug or id matches `q`, best match first.
 *
 * @param marks     the published fold's marks
 * @param q         the caller's query (non-empty; the door refuses an empty one)
 * @param at        the reader's own position, or null for a spectator
 * @param service   the vessel service (its stops), or null in a world with none
 */
/**
 * `words` names the door's own spelling of the two paging fields, so the
 * more_note tells the caller what to send at the door they called: the focus
 * on the bare read pages with find_offset / find_limit (POS-280), the plain
 * GET twin with offset / limit.
 */
export function findMarks(marks = [], q, { at = null, service = null, offset = 0, limit = FIND_CAP, words = { offset: "offset", limit: "limit" } } = {}) {
  const n = Math.min(Math.max(Math.floor(Number(limit)) || FIND_CAP, 1), FIND_MAX);
  const start = Math.max(Math.floor(Number(offset)) || 0, 0);
  const names = new Map();
  for (const m of marks) if (m?.kind === "naming" && m.parent && m.value && !names.has(m.parent)) names.set(m.parent, String(m.value));
  const reader = point(at) ? { x: Number(at.x), y: Number(at.y) } : null;
  const stops = stopsOfService(service);

  const ranked = [];
  for (const m of marks) {
    if (!m?.id || !placed(m) || m.kind === "naming") continue;
    const name = names.get(m.id) ?? prettyName(m.id);
    const rung = rungOf(m, name, q);
    if (rung != null) ranked.push({ m, name, rung });
  }
  ranked.sort((a, b) => a.rung - b.rung || a.name.length - b.name.length || String(a.m.id).localeCompare(String(b.m.id)));

  const hits = ranked.slice(start, start + n).map(({ m, name }) => {
    const markAt = { x: Number(m.at.x), y: Number(m.at.y) };
    const d = reader ? Math.round(straightLineM(reader, markAt)) : null;
    return {
      id: m.id,
      name,
      owner: m.by ?? null,
      kind: m.kind ?? null,
      class: m.class ?? null,
      at: markAt,
      distance_m: d,
      how_to_get_there: routeTo(markAt, reader, stops, d),
    };
  });
  const total = ranked.length;
  const next = start + hits.length;
  const complete = next >= total;
  return {
    q,
    matches: total,
    shown: hits.length,
    limit: n, offset: start, complete,
    ...(complete ? {} : { next_offset: next,
      more_note: `${total - next} further mark${total - next === 1 ? "" : "s"} match "${q}" — call again with ${words.offset}: ${next} (${words.limit} up to ${FIND_MAX})` }),
    stops: stops.map((s) => s.markId),
    hits,
  };
}
