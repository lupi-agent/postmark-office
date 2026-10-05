// households-read.mjs — GET /households: the household registry, as the store holds it (POS-345).
//
// Darko's ruling, 2026-10-04: git can be written to, the store reads git, the
// store is the record, and every reader reads the store. The town's
// tools/households.json and tools/github-ids.json are the store's PRINTOUT
// (tools/registry-drain.mjs), and readers that cannot reach Postgres — the
// town's tools and CI, the site's build, the PR witness (POS-348) — read them
// as if they were the record. This is the read those readers take instead.
//
// ── THE CONTRACT (stable; POS-348 and the town's --registry readers build on it) ──
//
//   GET /households            public, no key
//   GET /households?h=a,b      only what those handles touch (see below)
//
//   200 {
//     read: "households",
//     registry: { schema_version, note, households: { <slug>: { … } } }   tools/households.json's shape
//     pins:     { <handle>: { login, id, pinned?, … } }                  tools/github-ids.json's shape
//     handles?: [a, b]                                                    present only when ?h= was asked
//     from: "the registry store"
//   }
//   503 { error, defect, hint }    the office could not read the store; nothing is guessed in its place
//   422 { … }                      a malformed ?h=
//
// `registry` and `pins` are the SAME objects the drain renders the two files
// from (`registryFromRows` / `pinsFromRows`), key order included, so a reader
// that used to parse the files reads `registry` and `pins` with nothing in
// between. A caller holding a file today can hand this answer's two halves to
// the same function.
//
// `?h=a,b` (comma-separated resident handles, at most 50): `pins` keeps only
// those handles' pins, and `registry.households` keeps only the houses those
// handles stand in — by the one deriver (`household-deriver.mjs § resolveHouse`),
// the same walk every office resolver uses. A handle no house holds and no pin
// names contributes nothing; it is not an error. The registry's own top-level
// keys (`schema_version`, `note`) always ride.

import { loadRegistryRows } from "./registry-store.mjs";
import { registryFromRows, pinsFromRows } from "./registry-rows.mjs";
import { resolveHouse } from "./household-deriver.mjs";

const HANDLE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
export const MAX_HANDLES = 50;

/** Pure: the registry and pins narrowed to what `handles` touch. */
export function narrowTo(registry, pins, handles) {
  const keep = new Set(handles);
  const outPins = {};
  for (const [h, p] of Object.entries(pins ?? {})) if (keep.has(h)) outPins[h] = p;
  const slugs = new Set();
  for (const h of handles) {
    const { slug } = resolveHouse(h, registry, pins);
    if (slug) slugs.add(slug);
  }
  const houses = {};
  for (const [slug, rec] of Object.entries(registry?.households ?? {})) if (slugs.has(slug)) houses[slug] = rec;
  const { households: _all, ...meta } = registry ?? {};
  return { registry: { ...meta, households: houses }, pins: outPins };
}

/** Parse `?h=`; `{ handles }`, `{ bad }`, or `{}` when absent. */
export function parseHandles(raw) {
  if (raw == null) return {};
  const handles = [...new Set(String(raw).split(",").map((s) => s.trim()).filter(Boolean))];
  if (!handles.length) return { bad: "h= names no handle — pass h=<handle>[,<handle>…], or leave it off for the whole registry" };
  if (handles.length > MAX_HANDLES) return { bad: `h= names ${handles.length} handles; at most ${MAX_HANDLES} per read — leave it off for the whole registry` };
  const wrong = handles.find((h) => !HANDLE.test(h));
  if (wrong) return { bad: `h= carries "${wrong.slice(0, 80)}", which is not a resident handle` };
  return { handles };
}

/**
 * The read. `rows` is injectable for the suite; otherwise the store is asked.
 * Answers `{ status, body }`.
 */
export async function householdsRead(query = {}, { rows: given } = {}) {
  const asked = parseHandles(query.h);
  if (asked.bad) return { status: 422, body: { error: "bounce", defect: "a malformed h=", hint: asked.bad } };
  let rows;
  try { rows = given === undefined ? await loadRegistryRows() : given; } catch { rows = null; }
  if (!rows) return { status: 503, body: { error: "bounce", defect: "the office cannot read the household registry",
    hint: "the registry store did not answer, so nothing is guessed in its place — the town's printed tools/households.json and tools/github-ids.json are not the record. Try again shortly." } };
  let registry = registryFromRows(rows);
  let pins = pinsFromRows(rows);
  if (asked.handles) ({ registry, pins } = narrowTo(registry, pins, asked.handles));
  return { status: 200, body: { read: "households", registry, pins, ...(asked.handles ? { handles: asked.handles } : {}), from: "the registry store" } };
}
