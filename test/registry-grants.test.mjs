// registry-grants.test.mjs — the three-pens law, checked WITHOUT a database (POS-187).
//
// `world2/schema/003_falsifier_roles.sql` is the real falsifier: it enumerates
// every role holding INSERT/UPDATE/DELETE/TRUNCATE in the live database and
// prints a row for any that is not on its lawful list. Green = zero rows. It
// needs a database, so it runs on the box.
//
// This is the half that can run in CI, and it catches the one way 003 goes
// stale: a migration grants a write and forgets to add the matching row. That
// is not hypothetical — `014_escrow_projection.sql` did exactly this and the
// roles falsifier has been RED on prod ever since (named in 018's header, and
// named here, and NOT repaired by this lane: repairing it means deciding
// whether those grants are lawful, which is a ruling and not a test fix).
//
// So this test asserts the *forward* direction only — every write GRANT in
// `world2/schema/` appears on 003's lawful list — and it records 014's rows as
// the one known-missing set, with the count asserted so a SECOND forgotten
// grant reds immediately instead of hiding behind the first.
//
// ── THE SECOND MIGRATION RULE THIS FILE LINTS: `acts` IS APPEND-ONLY ─────────
//
// Same shape of failure, one table over. `002_grants.sql` arms
// `acts_append_only BEFORE UPDATE OR DELETE ON acts`, so a migration that
// writes to `acts` does not do the wrong thing — it ABORTS, and takes the rest
// of its transaction with it. `022_household_respell.sql` carried exactly such
// an UPDATE and the dev sandbox found it on 2026-09-22, on its SECOND run:
// the first matched nothing (the alias table was empty) and was silent, the
// second raised `ERROR: acts is append-only (World 2.0 rule: an act is never
// edited)` and rolled back the `claims` and `marks` work beside it. Prod would
// have refused it in the same words at the ship.
//
// THAT FILE IS NOW RETIRED to a header and `SELECT 1;`, because the other two
// tables refuse the same rewrite for the same reason — `claims_update_guard`
// requires `NEW.household IS NOT DISTINCT FROM OLD.household` on every lawful
// transition, and `marks_id_is_fixed` says it one table over. Three guards, one
// law: a row's household spelling is fixed for its life. The read side carries
// the fix instead (POS-160 RULING 4, `024_household_spellings.sql`). This lint
// is unchanged and still the thing that would catch the next attempt.
//
// A migration that cannot run is a red nobody sees until they run it, and the
// two-run trap means even running it once is not proof. So the rule is stated
// here, once, for every migration in the directory — including every one
// written after this sentence.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA = join(HERE, "..", "world2", "schema");

const WRITES = new Set(["INSERT", "UPDATE", "DELETE", "TRUNCATE"]);
// The owner is migrations, not a runtime pen — 003 excludes it by the same
// words, and this list must exclude it by the same words or the two disagree.
const NOT_A_PEN = new Set(["postgres", "world2_owner", "public"]);

/** Every `GRANT <privs> ON <tables> TO <roles>` in the schema, as flat triples. */
function grantsInSchema() {
  const out = [];
  for (const f of readdirSync(SCHEMA).filter((n) => n.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(SCHEMA, f), "utf8")
      .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    for (const m of sql.matchAll(/GRANT\s+([A-Za-z,\s]+?)\s+ON\s+(?:TABLE\s+)?([A-Za-z0-9_,\s]+?)\s+TO\s+([A-Za-z0-9_,\s]+?)\s*;/gi)) {
      const privs = m[1].split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
      if (privs.includes("ALL")) continue; // 002 grants the owner everything; not a runtime pen
      const tables = m[2].split(",").map((s) => s.trim()).filter(Boolean);
      const roles = m[3].split(",").map((s) => s.trim()).filter(Boolean);
      for (const p of privs) {
        if (!WRITES.has(p)) continue;
        for (const t of tables) for (const r of roles) {
          if (NOT_A_PEN.has(r)) continue;
          out.push({ file: f, grantee: r, table_name: t, privilege_type: p });
        }
      }
    }
  }
  return out;
}

/** Every schema file, comment lines stripped, as `{ file, sql }`. */
function schemaFiles() {
  return readdirSync(SCHEMA).filter((n) => n.endsWith(".sql")).sort().map((f) => ({
    file: f,
    sql: readFileSync(join(SCHEMA, f), "utf8")
      .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n"),
  }));
}

// A write to `acts`, in every spelling SQL allows for it: an optional schema
// qualifier, optional quotes, `ONLY`. `\bacts\b` and not `acts` alone, so that
// `acts_append_only` — the trigger 002 creates, named in a CREATE TRIGGER line
// in the very file that forbids this — is not read as a violation of itself.
const ACTS = String.raw`(?:ONLY\s+)?(?:public\s*\.\s*)?"?acts"?\b`;
const ACTS_WRITES = [
  { what: "UPDATE acts", re: new RegExp(String.raw`\bUPDATE\s+${ACTS}`, "gi") },
  { what: "DELETE FROM acts", re: new RegExp(String.raw`\bDELETE\s+FROM\s+${ACTS}`, "gi") },
  // TRUNCATE is here although the TRIGGER does not fire on it: `acts_append_only`
  // is `BEFORE UPDATE OR DELETE`, so a TRUNCATE would succeed and take the whole
  // log with it. That gap is the reason this lint covers three verbs and the
  // database covers two.
  { what: "TRUNCATE acts", re: new RegExp(String.raw`\bTRUNCATE\s+(?:TABLE\s+)?${ACTS}`, "gi") },
];

/** 003's own lawful list, parsed out of its VALUES block. */
function lawfulList() {
  const sql = readFileSync(join(SCHEMA, "003_falsifier_roles.sql"), "utf8");
  const set = new Set();
  for (const m of sql.matchAll(/\(\s*'([a-z_]+)'\s*,\s*'([a-z_]+)'\s*,\s*'([A-Z]+)'\s*\)/g))
    set.add(`${m[1]}|${m[2]}|${m[3]}`);
  return set;
}

// 014_escrow_projection.sql's grants, missing from 003's list since the day it
// shipped. Recorded, not repaired: whether they are lawful is a ruling.
const KNOWN_MISSING = [
  "law_ingester|escrow_projection|INSERT",
  "law_ingester|escrow_projection|DELETE",
];

test("019's own grants are on 003's lawful list", () => {
  const lawful = lawfulList();
  const mine = grantsInSchema().filter((g) => g.file === "019_households.sql");
  assert.ok(mine.length > 0, "019 grants at least one write, or this test proves nothing");
  for (const g of mine)
    assert.ok(lawful.has(`${g.grantee}|${g.table_name}|${g.privilege_type}`),
      `019 grants ${g.privilege_type} on ${g.table_name} to ${g.grantee}, and 003_falsifier_roles.sql does not list it — the three-pens falsifier will red on the box`);

  // The grants 019 is supposed to have written, stated so a silently dropped
  // GRANT line reds here rather than at the first door that needs it.
  const got = new Set(mine.map((g) => `${g.grantee}|${g.table_name}|${g.privilege_type}`));
  for (const want of [
    "office_api|households|INSERT", "office_api|households|UPDATE",
    "office_api|household_pins|INSERT", "office_api|household_pins|UPDATE",
    "office_api|registry_meta|INSERT", "office_api|registry_meta|UPDATE",
  ]) assert.ok(got.has(want), `019 must grant ${want.split("|").join(" ")}`);
});

test("019 grants no DELETE to any pen — a house is never removed", () => {
  // The town's own witness refuses a PR that removes a registry row ("nothing
  // removed", town tools/witness.mjs:31). The store must not be able to do what
  // the file's gate refuses.
  const mine = grantsInSchema().filter((g) => g.file === "019_households.sql");
  assert.deepEqual(mine.filter((g) => g.privilege_type === "DELETE"), []);
  assert.deepEqual(mine.filter((g) => g.privilege_type === "TRUNCATE"), []);
});

test("no write grant anywhere in world2/schema is missing from 003, beyond 014's known two", () => {
  const lawful = lawfulList();
  const missing = grantsInSchema()
    .map((g) => `${g.grantee}|${g.table_name}|${g.privilege_type}`)
    .filter((k) => !lawful.has(k));
  const unexpected = [...new Set(missing)].filter((k) => !KNOWN_MISSING.includes(k));
  assert.deepEqual(unexpected, [],
    "a migration granted a write and did not add it to 003_falsifier_roles.sql's lawful list — add the row in the same commit, or the roles falsifier reds on the box");
  // And the known red is still exactly the known red: if 014's grants get
  // repaired upstream, this line says so instead of silently widening.
  assert.deepEqual([...new Set(missing)].sort(), [...KNOWN_MISSING].sort(),
    "014_escrow_projection.sql's two grants are the one pre-existing gap; this list must not grow");
});

test("no migration in world2/schema writes to `acts` — an act is never edited", () => {
  // THE RULE, for every file in the directory and every file added after this
  // one. `002_grants.sql` arms `acts_append_only BEFORE UPDATE OR DELETE ON
  // acts`, so such a statement does not misbehave — it ABORTS with `acts is
  // append-only (World 2.0 rule: an act is never edited)` and rolls back
  // whatever real work its transaction was doing.
  //
  // 022_household_respell.sql shipped with exactly that UPDATE and the dev
  // sandbox met it on 2026-09-22, on the SECOND run: the first matched no rows
  // and said nothing. So "I ran the migration once and it was fine" is not
  // proof, which is why this is a lint over the text and not a runbook step.
  const found = [];
  for (const { file, sql } of schemaFiles())
    for (const { what, re } of ACTS_WRITES)
      for (const m of sql.matchAll(re)) found.push(`${file}: ${what} — ${m[0].replace(/\s+/g, " ")}`);

  assert.deepEqual(found, [],
    "a migration writes to `acts`, which is append-only by trigger (002_grants.sql `acts_append_only`) — "
    + "the statement will abort and take its transaction with it. AND `claims` AND `marks` ARE NOT THE "
    + "WAY ROUND IT: `claims_update_guard` and `marks_id_is_fixed` refuse a household re-spelling on those "
    + "two by the same law (measured on the dev sandbox 2026-09-22), which is why 022_household_respell.sql "
    + "is retired to a header and `SELECT 1;`. THE STORE NEVER RESPELLS A ROW. A house declares every "
    + "spelling it has ever carried instead — `src/household-deriver.mjs § houseKeysOf` and "
    + "`world2/schema/024_household_spellings.sql` (POS-160 RULING 4)");
});

test("the acts lint can actually fire — the pattern matches a write and not the trigger that forbids it", () => {
  // A lint asserting an empty list over files that never violate it would be
  // green forever whether or not the pattern works. So: the exact statement
  // 022 carried must be caught, and 002's own CREATE TRIGGER — which contains
  // the words `UPDATE OR DELETE ON acts` in the file that FORBIDS this — must
  // not be.
  const hits = (s) => ACTS_WRITES.filter(({ re }) => new RegExp(re.source, "i").test(s)).map((x) => x.what);

  assert.deepEqual(hits("UPDATE acts t SET household = 'hh:' || m.slug\n  FROM household_alias m"),
    ["UPDATE acts"], "022's own removed statement");
  assert.deepEqual(hits("DELETE FROM acts WHERE id = 1"), ["DELETE FROM acts"]);
  assert.deepEqual(hits('UPDATE public."acts" SET household = NULL'), ["UPDATE acts"]);
  assert.deepEqual(hits("TRUNCATE TABLE acts"), ["TRUNCATE acts"]);

  assert.deepEqual(hits("CREATE TRIGGER acts_append_only\n  BEFORE UPDATE OR DELETE ON acts\n  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();"),
    [], "002's trigger is the rule, not a breach of it");
  assert.deepEqual(hits("GRANT SELECT, INSERT ON acts TO office_api;"), []);
  assert.deepEqual(hits("UPDATE claims t SET household = 'hh:' || m.slug"), [],
    "the two tables 022 was going to respell are untouched by THIS lint — their own refusal is "
    + "`claims_update_guard` and `marks_id_is_fixed`, in the store rather than in a text check");
  assert.deepEqual(hits("SELECT 'acts' AS t, household, count(*) FROM acts GROUP BY 2"), [],
    "a READ of acts — which every one of 022's receipt blocks is — is not a write");
});

// ── 026's PRIVATE HARNESS ROW: office_api's alone, under a row policy ────────
//
// POS-208, ruled 2026-09-25: one `household_harnesses` row per resident holds a
// webhook url, a Letta conversation and a webhook's secret. The falsifier the
// brief names: "a `snapshot_reader` SELECT on household_harnesses is refused".
// Without a database that is three facts about the migration, each of which
// alone would refuse it, all asserted: no role but `office_api` is GRANTed
// anything on the table; row level security is enabled; and every policy on it
// is `TO office_api` and compares the acting household's spelling set. And the
// notary, which reads as `snapshot_reader`, does not name the table at all.
const HARNESSES = "household_harnesses";

/** Every GRANT of any privilege on `table`, as `{ file, privilege, grantee }`. */
function allGrantsOn(table) {
  const out = [];
  for (const { file, sql } of schemaFiles()) {
    for (const m of sql.matchAll(/GRANT\s+([A-Za-z,\s]+?)\s+ON\s+(?:TABLE\s+)?([A-Za-z0-9_,\s]+?)\s+TO\s+([A-Za-z0-9_,\s]+?)\s*;/gi)) {
      const tables = m[2].split(",").map((s) => s.trim());
      const allTables = /ALL\s+TABLES\s+IN\s+SCHEMA/i.test(m[0]);
      if (!tables.includes(table) && !allTables) continue;
      for (const p of m[1].split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))
        for (const r of m[3].split(",").map((s) => s.trim()).filter(Boolean))
          out.push({ file, privilege: p, grantee: r, allTables });
    }
  }
  return out;
}

test("026 · household_harnesses is GRANTed to office_api alone — SELECT, INSERT, UPDATE — and snapshot_reader holds nothing on it", () => {
  const named = allGrantsOn(HARNESSES).filter((g) => !g.allTables);
  assert.ok(named.length > 0, "026 grants nothing on household_harnesses, or this test proves nothing");
  assert.deepEqual([...new Set(named.map((g) => g.grantee))], ["office_api"]);
  assert.deepEqual(named.map((g) => g.privilege).sort(), ["INSERT", "SELECT", "UPDATE"]);
  // 002's `GRANT SELECT ON ALL TABLES IN SCHEMA public TO snapshot_reader` ran
  // before 026 existed, so it never reached this table — and if it were ever
  // re-run, the row policy below still answers that role nothing.
  for (const g of allGrantsOn(HARNESSES).filter((x) => x.allTables))
    assert.ok(Number(g.file.slice(0, 3)) < 26, `${g.file} grants ${g.privilege} on ALL TABLES after 026 — household_harnesses would be in it`);
  const lawful = lawfulList();
  for (const p of ["INSERT", "UPDATE"]) assert.ok(lawful.has(`office_api|${HARNESSES}|${p}`), `003 must list office_api ${p} on ${HARNESSES}`);
  assert.equal(lawful.has(`office_api|${HARNESSES}|DELETE`), false, "a registration is replaced, never removed");
});

test("026 · household_harnesses has row level security, and every policy is TO office_api and compares app.household_keys", () => {
  const sql = schemaFiles().find((f) => f.file === "026_events.sql").sql;
  assert.match(sql, /ALTER TABLE household_harnesses ENABLE ROW LEVEL SECURITY;/);
  const policies = [...sql.matchAll(/CREATE POLICY\s+(\w+)\s+ON\s+household_harnesses\s+FOR\s+(\w+)\s+TO\s+(\w+)([\s\S]*?);/gi)]
    .map((m) => ({ name: m[1], cmd: m[2].toUpperCase(), to: m[3], body: m[4] }));
  assert.deepEqual(policies.map((p) => p.cmd).sort(), ["INSERT", "SELECT", "UPDATE"]);
  for (const p of policies) {
    assert.equal(p.to, "office_api", `${p.name} is TO ${p.to}`);
    assert.match(p.body, /household = ANY\(string_to_array\(NULLIF\(current_setting\('app\.household_keys', true\), ''\), ','\)\)/, `${p.name} does not compare the spelling set`);
  }
  // No policy anywhere else names the table for another role.
  const others = schemaFiles().flatMap(({ file, sql: s }) =>
    [...s.matchAll(/CREATE POLICY\s+\w+\s+ON\s+household_harnesses[\s\S]*?TO\s+(\w+)/gi)].map((m) => `${file}:${m[1]}`))
    .filter((x) => !x.endsWith(":office_api"));
  assert.deepEqual(others, []);
});

test("026 · the notary's export (snapshot_reader) never reads household_harnesses", () => {
  const exporter = readFileSync(join(HERE, "..", "world2", "tools", "snapshot-export.mjs"), "utf8");
  assert.doesNotMatch(exporter, /household_harnesses/);
});
