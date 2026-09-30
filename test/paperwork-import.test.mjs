// paperwork-import.test.mjs — the equality the sign-in move commits on (POS-271).
//
// `importPaperwork` commits only when `compareTable` finds nothing, so that
// function is what "nobody was signed out" rests on. It is tested here without
// a store: rows as node:sqlite hands them back, against rows as node-postgres
// hands them back (int8 as strings). The copy itself was proved on a disposable
// Postgres (G:/Starstory/docs/2026-09-27/rail/pos-269/PROOF-027.txt); this
// suite keeps the equality honest from here on.
//
//   node --test test/paperwork-import.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { TABLES, compareTable } from "../world2/tools/paperwork-import.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const tokens = TABLES.find((t) => t.to === "oauth_tokens");
const COLS = ["token_hash", "kind", "gh_id", "gh_login", "client_id", "expires", "created", "held_by", "claimed_handle", "cosigned_gh_id", "cosigned_gh_login"];
const fileRow = { token_hash: "h1", kind: "access", gh_id: 67605380, gh_login: "keeminlee", client_id: "cl", expires: 4944080116, created: 1790000000, held_by: null, claimed_handle: null, cosigned_gh_id: null, cosigned_gh_login: null };
const storeRow = { ...fileRow, gh_id: "67605380", expires: "4944080116", created: "1790000000" };

test("EQUAL — the same row, int8 as a string on one side, is equal", () => {
  const r = compareTable(tokens, COLS, [fileRow], [storeRow]);
  assert.deepEqual(r.differ, []);
  assert.equal(r.sqlite, 1); assert.equal(r.store, 1);
});

test("ONE SECOND OFF ONE EXPIRY is a finding", () => {
  const r = compareTable(tokens, COLS, [fileRow], [{ ...storeRow, expires: "4944080115" }]);
  assert.equal(r.differ.length, 1);
  assert.match(r.differ[0], /\.expires: file "4944080116", store "4944080115"/);
});

test("A NULL THAT BECAME A VALUE (or the reverse) is a finding — custody must not appear or vanish", () => {
  assert.equal(compareTable(tokens, COLS, [fileRow], [{ ...storeRow, held_by: "resident" }]).differ.length, 1);
  assert.equal(compareTable(tokens, COLS, [{ ...fileRow, held_by: "resident" }], [storeRow]).differ.length, 1);
});

test("A MISSING ROW and an EXTRA ROW are both findings, counted", () => {
  const missing = compareTable(tokens, COLS, [fileRow, { ...fileRow, token_hash: "h2" }], [storeRow]);
  assert.equal(missing.missing, 1);
  const extra = compareTable(tokens, COLS, [fileRow], [storeRow, { ...storeRow, token_hash: "h3" }]);
  assert.equal(extra.extra, 1);
});

test("A COLUMN THE STORE LACKS is a finding, never a silent drop", () => {
  const { held_by, ...narrow } = storeRow;
  const r = compareTable(tokens, COLS, [fileRow], [narrow]);
  assert.ok(r.differ.some((d) => /oauth_tokens\.held_by: the store has no such column/.test(d)));
});

test("A COMPOSITE KEY matches on every part (office_roles is keyed by subject AND role)", () => {
  const roles = TABLES.find((t) => t.to === "office_roles");
  const c = ["subject", "role", "login", "granted_at", "granted_by", "note"];
  const row = { subject: "67605380", role: "subscriber", login: "keeminlee", granted_at: "2026-09-27T00:00:00.000Z", granted_by: "keemin", note: null };
  const r = compareTable(roles, c, [row], [{ ...row, role: "other" }]);
  assert.equal(r.missing, 1); assert.equal(r.extra, 1);
});

test("EVERY TABLE THE TOOL COPIES IS ONE 031 OR 032 CREATES, and 003 names a write grant for each", () => {
  const sql = ["031_office_paperwork.sql", "032_office_ledgers.sql"]
    .map((f) => readFileSync(join(HERE, "..", "world2", "schema", f), "utf8")).join("\n");
  const lawful = readFileSync(join(HERE, "..", "world2", "schema", "003_falsifier_roles.sql"), "utf8");
  for (const t of TABLES) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${t.to} \\(`), `neither 031 nor 032 creates ${t.to}`);
    assert.match(lawful, new RegExp(`\\('office_api',\\s+'${t.to}',\\s+'INSERT'\\)`), `003 has no INSERT row for ${t.to}`);
  }
});

test("THE WHOLE OF oauth.db MOVES: every table the office creates in the file has a row here", () => {
  // The office's own DDL, read off the modules that write oauth.db, is the
  // denominator. A table added to the file later with no row in TABLES would
  // be left behind by the import, and the switch would lose it silently.
  const src = (f) => readFileSync(join(HERE, "..", "src", f), "utf8");
  const created = new Set();
  for (const f of ["oauth.mjs", "media.mjs", "town-journal.mjs", "roles.mjs"])
    for (const m of src(f).matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)) created.add(m[1]);
  const copied = new Set(TABLES.map((t) => t.from));
  assert.deepEqual([...created].filter((t) => !copied.has(t)), [], "a table the office writes to its files has no import row");
});

test("THE LAZY TABLES are exactly the three created on first use (media, the town log, its cursor)", () => {
  assert.deepEqual(TABLES.filter((t) => t.lazy).map((t) => t.from).sort(), ["media", "meta", "town_journal"]);
});
