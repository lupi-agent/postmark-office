// law-classes.mjs — the class layer, read from law_projection at the newest
// blessing instead of from world.db (POS-270, 2026-09-27).
//
// "The bless overrides the tick" (Keemin, 2026-09-18, postmark#2934): world.db
// was hydrated at the newest `settlement/S<n>` tag, never at main, and a class
// read that moves to the store keeps that tense. The law pen ingests the blessed
// sha on its own run (`world2-ingest.sh law` → `law-ingest.mjs --blessed`), and
// the store's `settlements` table names the tag. So the pin is the newest
// settlement whose sha the law pen has ingested — and when the newest settlement
// is NOT yet ingested, the answer comes from the one before it and SAYS so,
// rather than reaching for main.
//
// PURE below the query: rows in, answers out, the same answers world-classes.mjs
// gives off world.db. Measured at S83 against a world.db hydrated at the same
// sha: roster 155/155, frontmatter dials 155/155, predicate children 155/155
// classes (89 slots), dial nodes 89/89 (test/law-classes-parity.test.mjs holds
// it per class and per slot).

// Every row the class readers need, at the pin. `number`/`tag_sha` ride on each
// row so one round trip answers both "which blessing" and "what it says".
// `newest` is the newest settlement at all, so a pin behind it is disclosed.
export const LAW_AT_BLESSING_SQL = `
  WITH newest AS (SELECT max(number) AS n FROM settlements),
       pin AS (
         SELECT s.number, s.tag_sha FROM settlements s
          WHERE EXISTS (SELECT 1 FROM law_projection l WHERE l.law_sha = s.tag_sha)
          ORDER BY s.number DESC LIMIT 1)
  SELECT pin.number, pin.tag_sha, newest.n AS newest, l.kind, l.key, l.data
    FROM pin CROSS JOIN newest
    JOIN law_projection l ON l.law_sha = pin.tag_sha AND l.kind IN ('class', 'predicate')
   ORDER BY l.kind, l.key`;

/**
 * The query's rows → one snapshot of the class layer.
 * `{ pin: { settlement, sha, newest }, classes: Map<name, record>, predicates: Map<name, Map<slot, {value, id}>>, disclosed }`
 * or null when the store holds no ingested blessing at all.
 */
export function lawSnapshotFromRows(rows) {
  if (!rows?.length) return null;
  const { number, tag_sha, newest } = rows[0];
  const classes = new Map();
  const predicates = new Map();
  for (const r of rows) {
    if (r.kind === "class") classes.set(String(r.key), r.data ?? {});
    else if (r.kind === "predicate") {
      const d = r.data ?? {};
      const k = String(d.class);
      if (!predicates.has(k)) predicates.set(k, new Map());
      predicates.get(k).set(String(d.slot), { value: d.value ?? null, id: d.id ?? null });
    }
  }
  const settlement = Number(number);
  const newestN = newest == null ? settlement : Number(newest);
  return {
    pin: { settlement, sha: String(tag_sha), newest: newestN },
    classes, predicates,
    disclosed: newestN > settlement
      ? `the class layer answers from S${settlement} (${String(tag_sha).slice(0, 12)}); S${newestN} is blessed but its law is not ingested yet`
      : null,
  };
}

/** The class names law knows — world-classes § classRoster's ROSTER_SQL. */
export const rosterOf = (snap) => new Set(snap.classes.keys());

/** A class's frontmatter `dials` object — world-classes § classDials. */
export function dialsOf(snap, name) {
  const d = snap.classes.get(String(name))?.dials;
  const v = typeof d === "string" ? (() => { try { return JSON.parse(d); } catch { return null; } })() : d;
  return (v && typeof v === "object" && !Array.isArray(v)) ? v : {};
}

/** A class's predicate children as `slot -> value` — world-classes § classPredicates. */
export function predicatesOf(snap, name) {
  const out = {};
  for (const [slot, p] of snap.predicates.get(String(name)) ?? []) out[slot] = p.value;
  return out;
}

/** Where a class's slot lives, as the record spells it — world-classes § dialNode. */
export function predicateNodeOf(snap, name, slot) {
  return snap.predicates.get(String(name))?.get(String(slot))?.id ?? null;
}
