// registry-store.mjs — the household registry, READ FROM THE STORE (POS-187).
//
// `src/registry-rows.mjs` is the pure round trip. This file is the half that
// touches Postgres: it reads `households`, `household_pins` and
// `registry_meta` through the office's ONE pool (`world2-acts.mjs actsQuery`,
// `WORLD2_PG_URL`, role `office_api`) and hands back exactly the shapes the
// registry's readers already hold —
//
//     { schema_version, note, households: { <slug>: { … } } }     the registry
//     { <handle>: { login, id, … } }                              the pins
//
// so a caller can feed the result straight to `houseForAccount`,
// `houseForName`, `conformance` or `planRegistryJoin` with nothing in between.
// That is deliberate: the store read is not a new vocabulary, it is the SAME
// object arriving by a different road, and the round-trip falsifier is what
// makes "the same object" a measured claim rather than a hope.
//
// ── NULL IS NOT EMPTY ───────────────────────────────────────────────────────
//
// `actsQuery` answers `null` — never `[]` — when the office is not pointed at
// the record, and this module keeps that distinction all the way up.
// `loadRegistryRows()` returns `null` for "I could not look" and a rows object
// for "I looked". A registry read that turned "I could not look" into "the town
// has no households" would hand `planRegistryJoin` an empty registry, and an
// empty registry is a registry in which every account is unknown and every
// house is available — which mints duplicates over live rows. The callers
// below must branch on null, and the one that cannot is named in the header of
// this lane's PR as the reason the door readers did not move this week.
//
// ── WHY NOTHING IN `src/` IMPORTS THIS YET ──────────────────────────────────
//
// See § THE STOP in the PR body, and the same sentence here so it is impossible
// to wire this in by accident:
//
//     The ceremony that DECLARES a household reads the registry, folds a whole
//     new registry object over it, and commits that object as the FILE
//     (src/declare-exec.mjs:50 + src/declare.mjs:410, src/residency.mjs:547 +
//     :584). Nothing writes the table. So a reader switched to the store today
//     would read a table frozen at its seed, fold over it, and commit a file
//     that DROPS every house declared since — which is precisely the revert
//     `src/residency.mjs:540-546` already warns about, arriving by the other
//     door. The table has to gain its write (POS-158's mint, which calls
//     `drainRegistry()` after its own commit) before any reader may leave the
//     file.
//
// Until then this module is proven against fixtures and imported by nothing at
// a door. `tools/registry-drain.mjs` uses it, and it only ever READS.

import { actsQuery } from "./world2-acts.mjs";
import { registryFromRows, pinsFromRows, HOUSEHOLD_KEYS, PIN_KEYS } from "./registry-rows.mjs";

// ORDER BY `ord`, always. The file's 118 keys are in declaration order and
// nothing derives it (measured 2026-09-22: not sorted, and `since` runs
// backwards at 36 of them), so the column is the only place that order lives
// and a query without this clause would make the town's file depend on the
// planner's mood.
//
// `formerly` (migration 020, POS-158) and `provisional` (migration 021,
// POS-159) are selected like any other column and carried through untouched.
// `node-postgres` hands a `text[]` back as a JS array of strings and a `boolean`
// back as a JS boolean, which is exactly what `registryFromRows` wants — and its
// renderer drops each key at its own default (an empty array, a false), which
// today is all 118 rows for both.
const HOUSEHOLDS_SQL = `
  SELECT slug, ord, name, human, accounts, residents, since, member_of, declared_by, formerly,
         provisional
    FROM households
   ORDER BY ord`;

// Pins are sorted by handle in the renderer (`serializePins` sorts), so this
// ORDER BY is for a human reading a log, not for the bytes.
const PINS_SQL = `
  SELECT handle, login, gh_id, pinned, renamed, note, retired, renamed_to
    FROM household_pins
   ORDER BY handle`;

// ── THE FILE'S TOP-LEVEL KEY ORDER, WRITTEN ONCE ────────────────────────────
//
// `tools/households.json` opens `schema_version`, then `note`, then
// `households`. `registryFromRows` emits the meta keys in the order it receives
// them, so this list is what decides the file's first bytes. It is STATED
// rather than stored, for the reason `loadRegistryRows`'s doc gives: two keys,
// and a column holding their order would be a column nobody could read.
//
// NOT ALPHABETICAL, and that is the whole point — `note` sorts before
// `schema_version`, so an `ORDER BY key` would spell the file's first two lines
// the wrong way round on every crossing.
const META_KEYS = Object.freeze(["schema_version", "note"]);

// ── AND THE QUERY ORDERS BY IT, RATHER THAN BY THE PLANNER'S MOOD ───────────
//
// `foldRegistryRows` already puts the two keys above back in the file's order,
// so the bytes the town has today were never at risk. WHAT WAS: any meta key
// BEYOND those two. The fold appends such a key in the order the rows arrived,
// and `SELECT key, value FROM registry_meta` with no ORDER BY hands them back
// in whatever order the planner liked that morning. MEASURED: the same two
// extra keys arriving two ways render `…,note,zeta,alpha,households` and
// `…,note,alpha,zeta,households` — two different files from one store.
//
// So the tail is ordered by `key`, which is a real order rather than an absent
// one, and the head is ordered by the list above EXPLICITLY. Both halves are
// built from `META_KEYS`, so the SQL and the fold cannot drift apart: there is
// one order here and two readers of it, not two orders.
//
// Its siblings `HOUSEHOLDS_SQL` and `PINS_SQL` both order deliberately, for the
// reason 019's header states — a SELECT with no ORDER BY returns whatever the
// planner liked and the file's bytes would then depend on the weather. This one
// was the exception and is no longer.
const META_SQL = `
  SELECT key, value FROM registry_meta
   ORDER BY CASE key${META_KEYS.map((k, i) => ` WHEN '${k}' THEN ${i}`).join("")} ELSE ${META_KEYS.length} END, key`;

/**
 * The same three tables, read through a QUERYABLE the caller already holds.
 *
 * `loadRegistryRows` reaches for the module's own pool, which is the right
 * shape for a door or a tool: it asks the store, and `null` means the office is
 * not pointed at the record. It is the WRONG shape for `householdKeyFor`, which
 * is handed a client that is already inside a transaction and — in every suite
 * that has ever tested it — a stub pool that is the only store in the room.
 * Reaching past that argument to the module pool would make the resolver answer
 * from a different store than the one its caller is writing to, which is the
 * two-queue disease with the queues renamed.
 *
 * So: same SQL, same fold, the caller's queryable. No `world2Enabled` gate —
 * a caller holding a client has already passed one — and a THROW rather than a
 * `null` if the tables are not there, because a pool that answers some of this
 * store's questions and not others is a fact worth failing on.
 *
 * (POS-160. `loadRegistryRows` is this function against the module pool, and
 * it stays the entry point for everything that is not already holding one.)
 */
export async function registryRowsVia(q) {
  const [households, pins, meta] = await Promise.all([
    q.query(HOUSEHOLDS_SQL).then((r) => r.rows),
    q.query(PINS_SQL).then((r) => r.rows),
    q.query(META_SQL).then((r) => r.rows),
  ]);
  return foldRegistryRows(households, pins, meta);
}

/** The three result sets -> the rows shape. One fold, two readers. */
function foldRegistryRows(households, pins, meta) {
  const byKey = new Map(meta.map((r) => [r.key, r.value]));
  const ordered = {};
  // The same `META_KEYS` the query orders by, then every other key BY KEY —
  // the same two-part order, in the same direction, as `META_SQL`'s ORDER BY.
  //
  // THE TAIL IS SORTED HERE AND NOT LEFT TO THE QUERY, although the query now
  // orders it too. A fold that trusted the ORDER BY would hold this property
  // only for rows that arrived through that one statement, and no test without
  // a real Postgres could ever see it — a stub hands back the order it chose,
  // `ORDER BY` or not. Sorted here, the file's top level is one order whatever
  // hands the rows over, and `registry-drain.test.mjs` can prove it. The SQL
  // clause is the matching half: it keeps the planner out of a log a person
  // reads, and keeps the two roads spelling one order.
  for (const k of META_KEYS) if (byKey.has(k)) ordered[k] = byKey.get(k);
  for (const k of [...byKey.keys()].sort()) if (!(k in ordered)) ordered[k] = byKey.get(k);

  return {
    meta: ordered,
    // `gh_id` comes back from `pg` as a STRING for bigint columns (node-postgres
    // will not silently narrow a bigint to a float), and the file spells the id
    // as a NUMBER. Every live id fits a double with room to spare — GitHub's
    // largest here is 332132909, eleven orders below 2^53 — so this coercion is
    // lossless today and the column stays bigint so the town never meets the
    // 2^31 wall at a door. `pinsFromRows` does the same coercion for the same
    // reason; both are named so neither reads as an accident.
    households: households.map((r) => ({ ...r, ord: Number(r.ord) })),
    pins,
  };
}

/**
 * The three tables -> the rows shape `registry-rows.mjs` folds and unfolds.
 *
 * `null` = the office is not pointed at the record. Never `{}`.
 *
 * `meta` is rebuilt in the FILE'S key order — `schema_version` first, then
 * `note` — because those two are the first bytes of `tools/households.json` and
 * a meta table read back in primary-key order would spell them the other way
 * round. The order is stated here rather than stored, because it is two keys
 * and a column holding it would be a column nobody could read.
 */
export async function loadRegistryRows(env = process.env) {
  const [households, pins, meta] = await Promise.all([
    actsQuery(HOUSEHOLDS_SQL, [], env),
    actsQuery(PINS_SQL, [], env),
    actsQuery(META_SQL, [], env),
  ]);
  if (households === null || pins === null || meta === null) return null;
  return foldRegistryRows(households, pins, meta);
}

/** The registry object, as the clone's `tools/households.json` parses to. `null` = not asked. */
export async function loadRegistry(env = process.env) {
  const rows = await loadRegistryRows(env);
  return rows === null ? null : registryFromRows(rows);
}

/** The pins object, as the clone's `tools/github-ids.json` parses to. `null` = not asked. */
export async function loadPins(env = process.env) {
  const rows = await loadRegistryRows(env);
  return rows === null ? null : pinsFromRows(rows);
}

// ── the writers ─────────────────────────────────────────────────────────────
//
// `office_api` holds INSERT and UPDATE on all three tables (019_households.sql)
// and no DELETE anywhere. `insertRegistryRows` is the SEED's one-time fill.
// `upsertHousehold` and `upsertPin` are the hooks POS-158's mint calls, in its
// own transaction, before it calls `drainRegistry()` — they are exported and
// falsified here so that lane inherits a writer rather than inventing one.

const COLUMNS = ["slug", "ord", "name", "human", "accounts", "residents", "since", "member_of", "declared_by", "formerly", "provisional"];
const PIN_COLUMNS = ["handle", "login", "gh_id", "pinned", "renamed", "note", "retired", "renamed_to"];

const placeholders = (n, offset = 0) => Array.from({ length: n }, (_, i) => `$${i + 1 + offset}`).join(", ");
// `accounts` is jsonb and wants a STRING; `residents` and `formerly` are
// `text[]` and want the JS array itself, which `node-postgres` turns into a
// Postgres array literal. Stringifying either of those would store the literal
// characters `["a","b"]` in a text[] and the drain would render JSON inside
// JSON. The `?? null` fallback is for the nullable scalars only — the two array
// columns are NOT NULL with a `'{}'` default, and `[] ?? null` is `[]`, so an
// empty list reaches the column as an empty list rather than as a NULL.
// `provisional` joins the NOT NULL club and needs its own floor for the same
// reason the arrays do: `undefined ?? null` is `null`, and a NULL reaching
// `boolean NOT NULL` is a write that fails at the door of a ceremony that had
// already told a resident their house was founded. A caller that does not know
// about the column writes the column's own default.
const valuesOf = (row, cols) => cols.map((c) => {
  if (c === "accounts") return JSON.stringify(row[c] ?? []);
  if (c === "provisional") return row[c] === true;
  return row[c] ?? null;
});

/**
 * The seed's insert. Plain INSERTs, no ON CONFLICT: the seed has already
 * REFUSED unless the table was empty, so a conflict here means something
 * raced it and the right answer is to fail loudly rather than to merge two
 * fills into one registry.
 */
export async function insertRegistryRows(rows, env = process.env) {
  const counts = { households: 0, pins: 0, meta: 0 };
  for (const [k, v] of Object.entries(rows.meta ?? {})) {
    await actsQuery("INSERT INTO registry_meta (key, value) VALUES ($1, $2)", [k, JSON.stringify(v)], env);
    counts.meta++;
  }
  for (const r of rows.households ?? []) {
    await actsQuery(`INSERT INTO households (${COLUMNS.join(", ")}) VALUES (${placeholders(COLUMNS.length)})`,
      valuesOf(r, COLUMNS), env);
    counts.households++;
  }
  for (const r of rows.pins ?? []) {
    await actsQuery(`INSERT INTO household_pins (${PIN_COLUMNS.join(", ")}) VALUES (${placeholders(PIN_COLUMNS.length)})`,
      valuesOf(r, PIN_COLUMNS), env);
    counts.pins++;
  }
  return counts;
}

/** How many rows the three tables hold. The seed's refusal reads this. */
export async function registryRowCounts(env = process.env) {
  const r = await actsQuery(
    `SELECT (SELECT count(*) FROM households)     AS households,
            (SELECT count(*) FROM household_pins) AS pins,
            (SELECT count(*) FROM registry_meta)  AS meta`, [], env);
  if (r === null) return null;
  return { households: Number(r[0].households), pins: Number(r[0].pins), meta: Number(r[0].meta) };
}

// ── A NEW HOUSE TAKES ITS PLACE FROM THE DATABASE (POS-158, review 4/6) ───
//
// THE HOLE THIS CLOSES. `mintHousehold` used to read the rows, compute
// `max(ord) + 1` in JavaScript, and write that back — with no transaction
// between the read and the write. Two mints landing together both read the same
// highest ord and both chose the same next one. `households_ord_key` is UNIQUE
// and `upsertHousehold`'s ON CONFLICT names the SLUG only, so the second insert
// did not update anything: it threw. And the caller swallowed the throw into a
// `console.warn` while still telling the resident "the same PR declares your
// household" — a house that does not exist, announced as founded.
//
// The window between the read and the write is gone: the place is computed
// INSIDE the insert, so no caller can hold a stale answer.
//
// WHAT REMAINS, STATED PLAINLY RATHER THAN CLAIMED AWAY. Two transactions
// running under the same snapshot can still both see the same `max(ord)`, and
// one of them will lose the unique index. That case is now RECOVERABLE and
// never silent: `insertHousehold` retries a bounded number of times against a
// fresh snapshot, and a failure that survives the retries is thrown — where the
// ceremony turns it into a refusal the caller actually reads. A lost race costs
// a retry; it never costs a wrong row, and it never costs a false receipt.
const ORD_RETRIES = 3;
const isOrdCollision = (e) =>
  /households_ord_key|duplicate key value/i.test(String(e?.message ?? e));

/**
 * Insert a NEW house, with its place assigned by the database.
 *
 * `row.ord` is IGNORED and must be: this is the one writer that chooses a
 * place, and a caller that could choose one is the caller that raced. Returns
 * the row as written, `ord` included, so the caller can say where it landed.
 *
 * Deliberately NOT an upsert. A mint founds a house that does not exist; if the
 * slug is taken, that is `REFUSALS.TAKEN` and a person needs to hear it, not an
 * UPDATE that silently rewrites somebody's row.
 */
export async function insertHousehold(row, env = process.env) {
  const cols = COLUMNS.filter((c) => c !== "ord");
  const vals = valuesOf(row, cols);
  const sql = `INSERT INTO households (ord, ${cols.join(", ")})
               SELECT coalesce(max(ord), -1) + 1, ${placeholders(cols.length)} FROM households
               RETURNING ord`;
  let last = null;
  for (let attempt = 1; attempt <= ORD_RETRIES; attempt++) {
    try {
      const r = await actsQuery(sql, vals, env);
      if (r === null) return null;
      return { ...row, ord: Number(r[0].ord) };
    } catch (e) {
      last = e;
      if (!isOrdCollision(e)) throw e;   // a real failure is not a race
    }
  }
  throw last;
}

/** POS-158's hook: one house, EDITED in place — the place is the caller's. Never deletes. */
export async function upsertHousehold(row, env = process.env) {
  const set = COLUMNS.filter((c) => c !== "slug").map((c) => `${c} = EXCLUDED.${c}`).join(", ");
  return actsQuery(
    `INSERT INTO households (${COLUMNS.join(", ")}) VALUES (${placeholders(COLUMNS.length)})
       ON CONFLICT (slug) DO UPDATE SET ${set}`, valuesOf(row, COLUMNS), env);
}

/** POS-158's hook: one pin, inserted or edited in place. Never deletes. */
export async function upsertPin(row, env = process.env) {
  const set = PIN_COLUMNS.filter((c) => c !== "handle").map((c) => `${c} = EXCLUDED.${c}`).join(", ");
  return actsQuery(
    `INSERT INTO household_pins (${PIN_COLUMNS.join(", ")}) VALUES (${placeholders(PIN_COLUMNS.length)})
       ON CONFLICT (handle) DO UPDATE SET ${set}`, valuesOf(row, PIN_COLUMNS), env);
}

// ── A HOUSE CHOOSES ITS KEY ONCE (POS-159) ──────────────────────────────────
//
// WHY THIS IS AN UPDATE AND NOT AN INSERT-PLUS-DELETE. `slug` is the PRIMARY
// KEY, and no pen in this store holds DELETE (019: SELECT to four roles,
// INSERT/UPDATE to `office_api`, DELETE to nobody, because a house is not
// deleted). So "insert the new key and drop the old row" is not a thing this
// office can do — it would leave BOTH rows standing, the house duplicated, and
// the drain rendering it twice. The slug moves in place.
//
// AND IT KEEPS `ord`, which is the point. `ord` is the house's standing place
// in the town's file, and a rename that re-derived one would move the house to
// the end and rewrite every row after it — 118 lines of diff for one house
// stating its name. The UPDATE names no `ord` at all, so the column keeps what
// it holds and the file changes exactly one key.
//
// `household_pins` IS NOT TOUCHED, and that is a fact about the schema rather
// than an omission: a pin row carries `handle`, `login`, `gh_id` and four
// legacy notes (019) and NO household reference of any kind. The belonging
// lives in `households.residents`, which is a column of the row being renamed
// and therefore travels with it. Nothing in the pin table knows a slug, so
// nothing in it can be left pointing at an old one.
//
// ONE ROW OR NONE, AND THE CALLER IS TOLD WHICH. The WHERE clause names the old
// slug; a rename whose source has moved under it updates nothing and answers
// `null` rather than reporting success over a row it never found.

/**
 * Move a house's key, keeping its place — the choose-once write.
 *
 * `from`        the key the house holds now (the provisional one).
 * `to`          the key it is choosing. The CALLER checks the alphabet and that
 *               it is free; this function writes what it is told.
 * `formerly`    the new alias list, built by the caller (the old key appended).
 * `provisional` the new value, which the choose-once path sets false.
 * `name`        the display field. Passed EXPLICITLY, always, because this is a
 *               SET and not a patch: a declaration that stated a name would
 *               otherwise have it silently dropped, and one that stated none
 *               would have the house's standing name silently cleared. The
 *               caller decides which of those it means and says so.
 *
 * FOUR COLUMNS AND NO MORE. `ord` is named nowhere, so the house keeps its
 * standing place in the town's file and the rename rewrites one line instead of
 * moving the house to the end and rewriting every row after it. `accounts`,
 * `residents`, `since`, `human`, `member_of` and `declared_by` are the house's
 * own facts and a key changing is not news about any of them.
 *
 * Returns the renamed row's `{ slug, ord }`, or `null` when the office is not
 * pointed at the record or no row held `from`.
 */
export async function renameHousehold({ from, to, formerly = [], provisional = false, name = null }, env = process.env) {
  const r = await actsQuery(
    `UPDATE households
        SET slug = $1, formerly = $2, provisional = $3, name = $4
      WHERE slug = $5
  RETURNING slug, ord`,
    [to, formerly, provisional === true, name ?? null, from], env);
  if (r === null) return null;
  return r.length ? { slug: r[0].slug, ord: Number(r[0].ord) } : null;
}

// Re-exported so a future reader importing "the registry's grammar" gets it
// from one place whether it is reading the file or the table.
export { HOUSEHOLD_KEYS, PIN_KEYS };
