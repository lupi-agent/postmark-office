// registry-rows.mjs — THE ROUND TRIP, PURE (POS-187).
//
// The town's household registry is two JSON files in the town repo:
// `tools/households.json` (118 houses) and `tools/github-ids.json` (190 pins).
// POS-187 makes the STORE the record and the files a RENDERING of it. This
// module is the fold and the unfold, and nothing else — no database, no clock,
// no filesystem, no network. `tools/registry-seed.mjs` uses the fold,
// `tools/registry-drain.mjs` uses the unfold, and `src/registry-store.mjs`
// uses the unfold's object half.
//
// ── THE LAW THIS FILE EXISTS TO SATISFY ─────────────────────────────────────
//
//     renderRegistry(rowsFromRegistry(households, pins))  ===  the two files,
//                                                              byte for byte
//
// It is the gate on the whole flip. `registry-drain.mjs --check` runs it
// against the live clone and exits 1 naming the first differing line, and
// `test/registry-rows.test.mjs` runs it against the real 2026-09-22 fixtures.
// If it reds, the store is not the record yet and nothing may move onto it.
//
// ── WHY BYTE-EQUALITY IS REACHABLE AT ALL ───────────────────────────────────
//
// Measured on the live files (2026-09-22, town origin/main df732534a): both are
// EXACTLY `JSON.stringify(obj, null, 2) + "\n"` — the re-stringify of each
// parsed file is byte-equal to the file, LF throughout. So the whole problem
// reduces to rebuilding the same objects with the same KEY INSERTION ORDER, and
// two facts make that possible:
//
//   1. Every household's key order is a subsequence of one fixed template
//      (name, human, accounts, residents, since, member_of, declared_by) —
//      6 distinct live orderings, 0 mismatches over 118 rows.
//   2. Every pin's key order is a subsequence of one fixed template
//      (login, id, pinned, renamed, note, retired, renamed_to) —
//      7 distinct live orderings, 0 mismatches over 190 rows.
//
// So an ABSENT key and a key set to null are different things here, and this
// module keeps them different: a null column renders as NO KEY AT ALL. A house
// with no `name` is a house that has not said what it is called
// (src/residency.mjs § A HOUSE OF ONE — the card then reads
// "(unstated — ask them)"), and writing `"name": null` into the town's file
// would be both a lie and a diff.
//
// ── WHAT IS DERIVED AND WHAT IS STORED ──────────────────────────────────────
//
// The HOUSEHOLD order is stored (`ord`). The file's 118 keys are in declaration
// order, which is neither sorted nor date-ordered — measured: `Object.keys()`
// differs from its own `.sort()`, and `since` runs backwards at 36 of the 118.
// Nothing derives that order, so it is a column.
//
// The PIN order is derived: the file is sorted by handle, and the town's own
// `serializePins` (residency.mjs:148) sorts on every write. A column for it
// would be a second answer to a settled question.
//
// ── ONE SERIALIZER, NOT A SECOND ────────────────────────────────────────────
//
// The bytes come from `serializeRegistry` and `serializePins` in
// `src/residency.mjs` — the town pen's OWN writers, the ones every join and
// every declaration already commit through. This module builds the objects; it
// does not spell JSON. If the pen's spelling ever moves, the drain moves with
// it in the same breath, because it is literally the same function.
//
// NOTE, FOR WHOEVER TOUCHES `serializePins` NEXT: there are two spellings of it
// in this repo today and only one sorts. `src/residency.mjs:148` sorts;
// `src/declare.mjs:455` does not, and `src/declare.mjs:411` is what the
// declaration ceremony commits through. The live file IS sorted, so the sorted
// spelling is the one that matches today's bytes and the one this module uses —
// but a declaration landing through declare.mjs's unsorted writer would append
// its new handle at the END of the file and `--check` would red on the next
// crossing. That divergence is older than this lane and is named in the PR
// rather than fixed in it.

import { serializeRegistry, serializePins } from "./residency.mjs";

// The two key templates, stated once. Every renderer below walks these in
// order and skips what the row does not carry; every reader above checks its
// input against them. They are the file's grammar, and they are the only place
// that grammar is written down.
//
// THE TAIL OF THIS TEMPLATE IS TWO COLUMNS THAT USUALLY RENDER NOTHING, and
// they are appended in the order their migrations landed so that no standing
// key ever moves: `formerly` (POS-158, migration 020) after `declared_by`, then
// `provisional` (POS-159, migration 021) after that. 0/118 live rows carry
// either — measured on the town's own files, twice, a day apart.
//
// Both are keys an ordinary value must NOT render, which is why `isAbsent`
// alone is not enough for this template. A house rendering `"formerly": []` or
// `"provisional": false` would diff, and 118 of them would rewrite the whole
// file on the first crossing. An empty alias list and a NULL are the same fact
// ("this house has no former key"); so are a `false` and an absent
// `provisional` ("this house's key was chosen"). Both render as no key at all,
// exactly as a NULL `name` does — see the two narrow predicates below.
export const HOUSEHOLD_KEYS = Object.freeze([
  "name", "human", "accounts", "residents", "since", "member_of", "declared_by", "formerly",
  "provisional",
]);
export const PIN_KEYS = Object.freeze([
  "login", "id", "pinned", "renamed", "note", "retired", "renamed_to",
]);

// ── THE THIRD TEMPLATE, AND THE ONE THE STORE ACTUALLY FORCED ───────────────
//
// The two templates above order the keys of a HOUSE and of a PIN, both of which
// are built here out of named columns, so their order was never in doubt. An
// ACCOUNT is different: `households.accounts` is a `jsonb` column, and Postgres
// `jsonb` is not an object — it is a SORTED MAP. On the way in, every object's
// keys are reordered by LENGTH IN BYTES, then bytewise, and they come back out
// that way forever. Insertion order is not stored and is not recoverable from
// the column (`src/state-log-from-store.mjs § the three things` names the same
// property for `acts.payload`).
//
// `login` is 5 bytes and `id` is 2, so the store hands every account back as
// `{ id, login }` while the town's file spells it `{ "login", "id" }`. MEASURED
// ON A REAL POSTGRES (dev sandbox, 2026-09-22 19:07 EDT, after
// `registry-seed.mjs --apply`): `registry-drain.mjs --check` red with
// `tools/households.json differs at line 9 — store renders "id": 306985727, /
// the clone has "login": "vertas-marginalia",`. 121 accounts, so 121 blocks of
// the file, on the first crossing.
//
// So the render orders nested keys BY THIS TEMPLATE, never by the order the row
// arrived in. That restoration is legitimate here for the reason
// `state-log-from-store.mjs` gives for `witnesses` and refuses for `payload`:
// the shape is FIXED — 019's own header measured it, `login` 121/121 and `id`
// 121/121, exactly two keys, always both — and `accountMatches` reads
// `a.id`/`a.login` by name. An arbitrary payload has no such template and this
// file invents none.
export const ACCOUNT_KEYS = Object.freeze(["login", "id"]);

// Which household columns carry nested objects, and the template each one's
// objects are ordered by. `accounts` is the only one: `residents` and
// `formerly` are `text[]` of strings (no keys to reorder) and every other
// column is a scalar. If a later migration adds a second jsonb column, it
// arrives with its row here in the same commit, or the drain renders it in
// Postgres's order and reds on the first crossing.
const NESTED_KEYS = Object.freeze({ accounts: ACCOUNT_KEYS });

// A pin's column names are the file's key names except one: `id` is a reserved
// enough word in SQL company that the column is `gh_id`, and this is the single
// place the two spellings meet.
const PIN_COLUMN = Object.freeze({
  login: "login", id: "gh_id", pinned: "pinned",
  renamed: "renamed", note: "note", retired: "retired", renamed_to: "renamed_to",
});

const isAbsent = (v) => v === undefined || v === null;

// THE SECOND ABSENCE, and it belongs to exactly one column. `formerly` is
// `text[] NOT NULL DEFAULT '{}'`, so the store never hands back a NULL for it —
// it hands back `[]`, which `isAbsent` would happily render as a present empty
// key on all 118 houses. An empty alias list is not a value the file has ever
// carried, so it renders as nothing. Named as its own predicate rather than
// folded into `isAbsent` because widening `isAbsent` would also silence an
// empty `residents` or `accounts`, and a house with no residents IS a diff
// somebody needs to see.
const EMPTY_LIST_KEYS = new Set(["formerly"]);

// THE THIRD ABSENCE, and it belongs to exactly one column too. `provisional`
// (migration 021, POS-159) is `boolean NOT NULL DEFAULT false`, and it is TRUE
// only while nobody has chosen the house's key. 0/118 live rows carry it —
// measured 2026-09-22 — so `"provisional": false` on every house would rewrite
// the whole file on the first crossing, exactly as `"formerly": []` would.
//
// It gets its OWN predicate rather than joining `EMPTY_LIST_KEYS` because the
// two rules are different shapes: an empty array and a false are only alike if
// you squint at them through JavaScript's truthiness, and a `rendersAsAbsent`
// that dropped every falsy value would also silence `"since": ""` and a pin id
// of 0. Named narrowly, it can only ever do this one thing.
const FALSE_IS_ABSENT_KEYS = new Set(["provisional"]);

const rendersAsAbsent = (key, v) =>
  isAbsent(v)
  || (EMPTY_LIST_KEYS.has(key) && Array.isArray(v) && v.length === 0)
  || (FALSE_IS_ABSENT_KEYS.has(key) && v === false);

/**
 * A nested value with its object keys put back in the FILE's order.
 *
 * Walks arrays (a jsonb array IS ordered, and 019's header says the order of
 * `accounts` is part of the file's bytes, so it is never sorted here) and
 * rebuilds each object: the template's keys first, in the template's order,
 * then EVERY REMAINING KEY, sorted, so a key the template does not name is
 * rendered rather than dropped.
 *
 * That tail is the difference between this and the top-level templates, which
 * REFUSE an unknown key at the fold. A refusal is right there, where a person
 * is running the seed and can add the column. Here the value came out of a
 * `jsonb` column that accepts any shape, on a drain that may be running at
 * 05:45 at a crossing — so an unrecognised account key renders in a stable
 * place and shows up as a diff a person reads, instead of vanishing from the
 * town's file. It will be in the wrong PLACE, and `--check` will say so; it
 * will not be missing.
 */
const orderNested = (v, template) => {
  if (Array.isArray(v)) return v.map((x) => orderNested(x, template));
  if (v === null || typeof v !== "object") return v;
  const out = {};
  for (const k of template) if (Object.hasOwn(v, k)) out[k] = v[k];
  for (const k of Object.keys(v).sort()) if (!template.includes(k)) out[k] = v[k];
  return out;
};

/**
 * The two parsed files -> the rows the store holds.
 *
 * `households` rows carry `ord` (the file's own order, 0-based), every column
 * of 019_households.sql, and NOTHING ELSE. `pins` rows are keyed by handle.
 * `meta` is the file-level pair — `schema_version` and the registry `note` —
 * which belong to the FILE and to no house, and which the town's witness
 * requires untouched by a resident's PR (town tools/witness.mjs:31).
 *
 * THIS REFUSES RATHER THAN DROPS. A key the templates above do not name is a
 * field the town started carrying and this module cannot render; silently
 * omitting it would hand the drain a file that loses somebody's row content on
 * the next crossing, which is the one failure the whole round-trip law exists
 * to make impossible. So it throws, and the seed stops, and a person looks.
 */
export function rowsFromRegistry(householdsJson, pinsJson) {
  const doc = householdsJson ?? {};
  const houses = doc.households ?? {};
  const pinsDoc = pinsJson ?? {};

  const meta = {};
  for (const [k, v] of Object.entries(doc)) {
    if (k === "households") continue;
    meta[k] = v;
  }

  const households = [];
  let ord = 0;
  for (const [slug, rec] of Object.entries(houses)) {
    const unknown = Object.keys(rec ?? {}).filter((k) => !HOUSEHOLD_KEYS.includes(k));
    if (unknown.length)
      throw new Error(`household "${slug}" carries ${unknown.map((k) => `\`${k}\``).join(", ")}, which registry-rows.mjs has no column for — add the column AND its place in HOUSEHOLD_KEYS in the same commit, or the drain will render a file that drops it`);
    households.push({
      slug,
      ord: ord++,
      name: rec?.name ?? null,
      human: rec?.human ?? null,
      accounts: rec?.accounts ?? [],
      residents: rec?.residents ?? [],
      since: rec?.since ?? null,
      member_of: rec?.member_of ?? null,
      declared_by: rec?.declared_by ?? null,
      // The fold's side of the empty-list rule: a file with no `formerly` key
      // folds to the column's own default, never to NULL, so a seed and a
      // fresh INSERT put the same value in the same column.
      formerly: rec?.formerly ?? [],
      // Same for `provisional` (021): a file with no key folds to `false`, which
      // is the truth about every house that has ever declared. A NULL here would
      // reach a NOT NULL column and the seed would stop on it.
      provisional: rec?.provisional ?? false,
    });
  }

  const pins = [];
  for (const [handle, rec] of Object.entries(pinsDoc)) {
    const unknown = Object.keys(rec ?? {}).filter((k) => !PIN_KEYS.includes(k));
    if (unknown.length)
      throw new Error(`pin "${handle}" carries ${unknown.map((k) => `\`${k}\``).join(", ")}, which registry-rows.mjs has no column for — add the column AND its place in PIN_KEYS in the same commit, or the drain will render a file that drops it`);
    const row = { handle };
    for (const k of PIN_KEYS) row[PIN_COLUMN[k]] = isAbsent(rec?.[k]) ? null : rec[k];
    pins.push(row);
  }

  return { meta, households, pins };
}

/**
 * The rows -> the registry OBJECT, in the file's own key order.
 *
 * This is the shape `src/declare-exec.mjs` and `src/declare.mjs` read off the
 * clone today — `{ schema_version, note, households: { <slug>: { … } } }` — so
 * a store read can be handed straight to `houseForAccount`, `houseForName`,
 * `conformance` and `planRegistryJoin` with nothing in between.
 *
 * ORDER IS RESTORED HERE, not assumed from the query: rows are sorted by `ord`
 * before the object is built, because a `SELECT` with no `ORDER BY` returns
 * whatever the planner liked that morning and the file's bytes would then
 * depend on the weather.
 */
export function registryFromRows(rows) {
  const out = {};
  for (const [k, v] of Object.entries(rows?.meta ?? {})) {
    // `registry_meta.value` is jsonb too, and it has no template — it is
    // whatever the file's top level carries beside `households`. Live, that is
    // `schema_version` (a number) and `note` (one prose string): 2/2 SCALARS,
    // which jsonb cannot reorder, measured on the town's own files. An OBJECT
    // here would come back key-sorted with nothing to restore it from, so it
    // refuses rather than renders a file whose metadata block quietly moved —
    // the same refusal the fold makes for an unknown household column, at the
    // one other place a jsonb value reaches these bytes.
    if (v !== null && typeof v === "object")
      throw new Error(`registry_meta "${k}" holds an object, and jsonb returns an object's keys sorted by (length, bytes) with the file's order unrecoverable — give it a template in registry-rows.mjs before storing one, or the drain will render the metadata block in Postgres's order`);
    out[k] = v;
  }
  const households = {};
  for (const r of [...(rows?.households ?? [])].sort((a, b) => a.ord - b.ord)) {
    const rec = {};
    for (const k of HOUSEHOLD_KEYS) {
      const v = r[k];
      if (rendersAsAbsent(k, v)) continue;
      // The jsonb columns are re-ordered by their template; every other column
      // is a scalar or a `text[]` and passes through as it arrived.
      rec[k] = NESTED_KEYS[k] ? orderNested(v, NESTED_KEYS[k]) : v;
    }
    households[r.slug] = rec;
  }
  out.households = households;
  return out;
}

/**
 * The rows -> the pins OBJECT. Sorted by handle inside `serializePins`, so the
 * order this builds is not load-bearing; it is built sorted anyway, so that a
 * caller reading this object (rather than its bytes) sees the same order the
 * file has.
 */
export function pinsFromRows(rows) {
  const out = {};
  for (const r of [...(rows?.pins ?? [])].sort((a, b) => (a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0))) {
    const rec = {};
    for (const k of PIN_KEYS) {
      const v = r[PIN_COLUMN[k]];
      if (isAbsent(v)) continue;
      rec[k] = k === "id" ? Number(v) : v;
    }
    out[r.handle] = rec;
  }
  return out;
}

/**
 * The rows -> both files' exact bytes.
 *
 * `{ households, pins }`, each a string ready to be written or committed.
 * This is the half `--check` diffs and `--apply` commits, and it is the half
 * the round-trip falsifier proves against the real files.
 */
export function renderRegistry(rows) {
  return {
    households: serializeRegistry(registryFromRows(rows)),
    pins: serializePins(pinsFromRows(rows)),
  };
}

/**
 * The first line at which two renderings differ, 1-based, or null when they do
 * not. `--check` prints this; a diff reported as "they differ" and nothing else
 * is a red nobody can act on at 05:45 in the morning.
 */
export function firstDifferingLine(rendered, actual) {
  if (rendered === actual) return null;
  const a = String(rendered).split("\n");
  const b = String(actual).split("\n");
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return { line: i + 1, rendered: a[i] ?? "(end of file)", actual: b[i] ?? "(end of file)" };
  }
  return { line: n, rendered: "(end of file)", actual: "(end of file)" };
}
