// save-emissions.mjs — the save's EMISSION lines, from the acts record (POS-269).
//
// The crossing-save writes one `emission` line per voice into STATE/log/<N>.jsonl.
// Those lines were read out of dynamic.db's `emissions` table, which the say
// door fills as a second consumer of every voice (WORLD_EMISSIONS). Since the
// say lane's pen flipped (2026-09-03, `LANE_FLIPPED_AT.say`) every voice is also
// an act — class `voice`, action `say` — and the act carries everything the line
// says: the speaker, the words, the place, the deck flag, whom a human stood
// with, the instant, and where it was spoken as an anchor and an offset. So the
// line can be written from the record, and dynamic.db stops being a source of
// the public record.
//
// ── BYTE FOR BYTE, MEASURED ON THE TOWN'S OWN FILES ─────────────────────────
//
// The register photographs its acts into the world repo
// (`STATE/log/<N>.<frac>.journal.jsonl`), and the save's own lines sit beside
// them in `STATE/log/<N>.jsonl`. Rendered with this file's rule, every emission
// line whose act was photographed came back identical in every field — 340 of
// 340 over crossings 200–219 (docs/2026-09-30/rail/pos-269/MEASURE-*.txt). The
// lines with no photographed act fall after the newest photograph, not outside
// the record.
//
// ── THE RULE, FIELD BY FIELD (dynamic-emissions.mjs § recordEmission) ───────
//
//   id              `sound:<born ms>:<source>`, and `:2`, `:3` … for a second
//                   voice from one source in one millisecond, in record order
//   source (actor)  whom a human stood with (`payload.stood_with`), else the speaker
//   x, y            the act's anchor and offset, composed against the SAME fold
//                   the stamp wrote them against (world.mjs § markCentreOf)
//   born_at         the act's instant
//   ttl_expires_at  born + the sound class's hearing TTL
//   spoken_by       the speaker (the act's actor); `human` is spoken_by ≠ source
//   class_version, radius_m, ttl_min   the sound class, read as the save runs
//
// ⚑ THE CLASS IS READ AT THE SAVE, NOT AT THE SPEECH. dynamic.db kept the law
// each voice was born under; an act does not. The save writes a crossing a few
// minutes after it closes, so the two agree unless `the-town/sound` changed
// inside that window, and then the new lines carry the newer version. Named, not
// hidden: the sound class has been version 2 for every line measured.
//
// ⚑ A VOICE THAT CANNOT BE PLACED REFUSES THE SAVE. If an act's anchor no longer
// resolves (its mark is gone from the fold), there is no honest x,y for the
// line, and a public file must not carry a guessed one. The save refuses by
// name and writes nothing, as it does for an unreachable register.

import { officeRead } from "./world2-pen.mjs";
import { composeAnchor } from "./world-journal.mjs";

export const SOUND = "sound";

export class EmissionUnplacedError extends Error {
  constructor(acts) {
    super(`${acts.length} voice act(s) whose anchor no longer resolves in the fold (first: act ${acts[0].id}, ${acts[0].actor} at ${acts[0].at_anchor}) — no honest x,y for the line`);
    this.name = "EmissionUnplacedError";
    this.acts = acts;
  }
}

const iso = (v) => (v instanceof Date ? v : new Date(v)).toISOString();
const ms = (v) => (v instanceof Date ? v.getTime() : Date.parse(v));

/**
 * The emission rows for these voice acts, in the shape `emissionsBetween` hands
 * the save (`{ id, class, source, x, y, born_at, ttl_expires_at, props }`), so
 * `buildSave` reads them unchanged. `acts` in record order (at, id).
 */
export function emissionRowsFromActs(acts, { centreOf, cls, ttlMs, earshotM }) {
  const rows = [];
  const unplaced = [];
  const taken = new Set();
  for (const a of acts) {
    const payload = typeof a.payload === "string" ? JSON.parse(a.payload) : (a.payload ?? {});
    const source = payload.stood_with ?? a.actor;
    const bornMs = ms(a.at);
    const pos = composeAnchor({ anchor: a.at_anchor, dx: a.at_dx, dy: a.at_dy }, centreOf);
    if (!pos) { unplaced.push(a); continue; }
    const base = `${SOUND}:${bornMs}:${source}`;
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}:${n}`;
    taken.add(id);
    rows.push({
      id, class: SOUND, source,
      x: pos.x, y: pos.y,
      born_at: iso(bornMs),
      ttl_expires_at: iso(bornMs + ttlMs),
      props: {
        spoken_by: a.actor,
        text: payload.text ?? "",
        aboard: Boolean(payload.aboard),
        place: payload.place ?? null,
        human: a.actor !== source,
        class_version: cls.version,
        radius_m: earshotM,
        ttl_min: cls.dials.hearing_ttl_min,
      },
    });
  }
  if (unplaced.length) throw new EmissionUnplacedError(unplaced);
  return rows;
}

/** The say acts in [from, to), record order — the one query this file makes. */
export async function readSayActs(fromIso, toIso, { env = process.env } = {}) {
  return officeRead(async (c) => (await c.query(
    `SELECT id, at, actor, at_anchor, at_dx, at_dy, payload FROM acts
      WHERE class = 'voice' AND action = 'say' AND at >= $1 AND at < $2 ORDER BY at, id`,
    [fromIso, toIso])).rows, { env });
}
