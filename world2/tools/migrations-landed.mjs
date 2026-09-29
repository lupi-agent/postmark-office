// migrations-landed.mjs — WHICH MIGRATIONS A STORE HAS, READ FROM THE SCHEMA.
//
// There is no migrations table in this store (world2/tools/README.md § Applying
// a migration to a live store): every `world2/schema/*.sql` past the floor is
// hand-applied, and each file's own header says how to prove it landed. This is
// those proofs, one boolean query per file, so a tool can ask a store "which of
// these have you got" without anyone having written the answer down.
//
// Measured 2026-09-26 on prod (`world2_dev`), read-only: 001-018 true, 019-026
// false — the w40 train's migrations are the ones prod lacks.
//
// EVERY FILE HAS AN ENTRY, and `test/world2-rehearsal-guards.test.mjs` holds
// that: a new migration without a probe fails the suite, because a runner that
// cannot tell whether a migration landed would either re-apply it (014 is not
// idempotent) or skip it silently.
//
// An entry is one of:
//   { probe: "<SELECT returning one boolean>" }  — true = landed
//   { skip: "<why this file is not applied>" }    — 003 (a falsifier query, not a
//                                                   migration — the CI floor skips it
//                                                   for the same reason) and 022
//                                                   (the file does nothing)
//
// A probe asks for the LAST thing its file does where that is cheap, so a
// migration that half-landed outside its own transaction reads as not landed.
// 017 is a DATA migration and its probe is a data question: a row written with
// an object-shaped `source` after 017 ran would read as "017 missing" and the
// runner would re-apply it — which is safe, because 017's own statements are
// guarded UPDATEs (017's header), and is also the correct repair.

const col = (table, column) =>
  `EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${table}' AND column_name = '${column}')`;
const rel = (name) => `to_regclass('public.${name}') IS NOT NULL`;
const trig = (name, extra = "") => `EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = '${name}'${extra})`;
const policy = (name, extra = "") =>
  `EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'claims' AND policyname = '${name}'${extra})`;

export const LANDED = {
  "001_tables.sql":                { probe: rel("acts") },
  "002_grants.sql":                { probe: trig("acts_append_only") },
  "003_falsifier_roles.sql":       { skip: "not a migration — the three-pens falsifier query (the CI floor skips it too)" },
  "004_marks_data.sql":            { probe: col("claims", "parent") },
  "005_candle_tiling.sql":         { probe: "EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'windows_tile')" },
  "006_claim_identity.sql":        { probe: "to_regclass('public.claims_slug_idx') IS NOT NULL" },
  "007_private_drafts.sql":        { probe: policy("claims_delete_own_draft") },
  "009_review_ruling.sql":         { probe: col("claims", "ruling") },
  "010_town_roll.sql":             { probe: rel("town_roll") },
  // 011 re-creates the trigger to fire on UPDATE as well (tgtype bit 16).
  "011_candle_tiling_update.sql":  { probe: trig("windows_tile", " AND (tgtype & 16) <> 0") },
  "012_reidentification.sql":      { probe: "EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marks_formerly_is_a_list' AND convalidated)" },
  "014_escrow_projection.sql":     { probe: rel("escrow_projection") },
  "015_marks_locked_window.sql":   { probe: "to_regclass('public.marks_locked_window_idx') IS NOT NULL" },
  "016_marks_bbox_gist.sql":       { probe: "to_regclass('public.marks_bbox_gist') IS NOT NULL" },
  "017_source_underscore.sql":     { probe: "NOT EXISTS (SELECT 1 FROM marks WHERE jsonb_typeof(data -> 'source') = 'object')" },
  "018_settlements.sql":           { probe: rel("settlements") },
  "019_households.sql":            { probe: `${rel("households")} AND ${rel("household_pins")} AND ${rel("registry_meta")}` },
  "020_households_formerly.sql":   { probe: col("households", "formerly") },
  "021_households_provisional.sql": { probe: col("households", "provisional") },
  "022_household_respell.sql":     { skip: "the file does nothing (its own first line) — kept for its number" },
  "023_stance_reader.sql":         { probe: policy("claims_read_stance") },
  "024_household_spellings.sql":   { probe: policy("claims_delete_own_draft", " AND qual LIKE '%app.household_keys%'") },
  "025_drop_journal_seq.sql":      { probe: `NOT ${col("acts", "journal_seq")}` },
  "026_events.sql":                { probe: `${rel("events")} AND ${rel("event_rsvps")} AND ${rel("household_harnesses")} AND ${rel("earpiece_wakes")}` },
  "027_act_nonce.sql":             { probe: `${col("acts", "nonce")} AND ${rel("acts_actor_nonce_idx")}` },
  "028_posts.sql":                 { probe: `${rel("posts")} AND ${rel("responses")} AND ${col("posts", "class")} AND ${col("responses", "kind")}` },
  "029_letter_opens.sql":          { probe: `${rel("letter_opens")} AND ${col("letter_opens", "how")}` },
  // 030 (POS-292): the table, and the counting function WITH its fold of small cells.
  "030_arrival_heard.sql":         { probe: `${rel("arrival_heard")} AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'arrival_heard_weekly' AND prosrc LIKE '%fewer-than-3%')` },
};

/** The schema files in the order a store takes them — name order, as the CI floor applies them. */
export function schemaOrder(names) {
  return names.filter((n) => /^\d{3}_.+\.sql$/.test(n)).sort();
}

/** Ask a store which migrations it has. `query` is (text) => Promise<{rows}>. */
export async function landedIn(query, names) {
  const out = [];
  for (const file of schemaOrder(names)) {
    const entry = LANDED[file];
    if (!entry) { out.push({ file, state: "unknown", detail: "no probe in migrations-landed.mjs — refusing to guess" }); continue; }
    if (entry.skip) { out.push({ file, state: "skip", detail: entry.skip }); continue; }
    const { rows: [r] } = await query(`SELECT (${entry.probe}) AS landed`);
    out.push({ file, state: r.landed ? "landed" : "missing" });
  }
  return out;
}
