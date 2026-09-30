// law-blessed-ingest.test.mjs — the law pen's BLESSED run (POS-270, 2026-09-27).
//
// The office's class reads answer from law_projection at the newest blessing
// ("the bless overrides the tick", Keemin 2026-09-18, postmark#2934). main runs
// ahead of the tag between a crossing and its blessing, so the law pen also
// ingests the blessed sha — and that run must write ONLY that sha's rows.
// `identities` is the current roster and `projection_heads['world-law']` is the
// clearing's pin; a blessed run that moved either would hand the clearing an
// older rulebook than the one it had.
//
// Against a REAL Postgres (PGlite; test/helpers/pglite-store.mjs), because what
// is held is a transaction's effect on three tables.

import { test } from "node:test";
import assert from "node:assert/strict";

import { writeLaw } from "../world2/tools/law-ingest.mjs";
import { loadPglite, storeFloor } from "./helpers/pglite-store.mjs";

const MAIN = "a".repeat(40);
const BLESSED = "b".repeat(40);

const row = (key, data) => ({ kind: "class", path: `LOGOS/${key}.md`, key, data });
const who = (handle) => ({ handle, household: `hh:${handle}`, human: null, gh_login: null, gh_id: null, since: null, status: "resident", data: {} });

const pglite = await loadPglite();

test("a blessed run writes its sha's rows and leaves the roster and the clearing's pin alone", async (t) => {
  if (pglite.reason) return t.skip(pglite.reason);
  const db = await storeFloor(pglite);

  await writeLaw(db, { lawSha: MAIN, rows: [row("bounty", { v: "main" }), row("idea", { v: "main" })], identities: [who("alta"), who("wren")] });
  await writeLaw(db, { lawSha: BLESSED, rows: [row("bounty", { v: "blessed" })], identities: [who("someone-else")], blessed: true });

  const head = (await db.query("SELECT sha FROM projection_heads WHERE repo = 'world-law'")).rows;
  assert.deepEqual(head, [{ sha: MAIN }], "the blessed run moved the clearing's pin");
  const ids = (await db.query("SELECT handle FROM identities ORDER BY handle")).rows.map((r) => r.handle);
  assert.deepEqual(ids, ["alta", "wren"], "the blessed run replaced the current roster with its own");

  const bySha = (await db.query("SELECT law_sha, key, data FROM law_projection ORDER BY law_sha, key")).rows;
  assert.deepEqual(bySha.map((r) => [r.law_sha, r.key, r.data.v]), [
    [MAIN, "bounty", "main"], [MAIN, "idea", "main"], [BLESSED, "bounty", "blessed"],
  ], "both shas' rows stand side by side; neither run touched the other's");
  await db.close();
});

test("a blessed run re-run is a no-op, and a main run after it still moves the pin", async (t) => {
  if (pglite.reason) return t.skip(pglite.reason);
  const db = await storeFloor(pglite);
  const rows = [row("bounty", { v: "blessed" })];
  await writeLaw(db, { lawSha: BLESSED, rows, identities: [], blessed: true });
  await writeLaw(db, { lawSha: BLESSED, rows, identities: [], blessed: true });
  assert.equal((await db.query("SELECT count(*)::int AS n FROM law_projection WHERE law_sha = $1", [BLESSED])).rows[0].n, 1);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM projection_heads")).rows[0].n, 0,
    "a blessed run on an empty store invented a head");

  await writeLaw(db, { lawSha: MAIN, rows: [row("bounty", { v: "main" })], identities: [who("alta")] });
  assert.equal((await db.query("SELECT sha FROM projection_heads WHERE repo = 'world-law'")).rows[0].sha, MAIN);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM law_projection WHERE law_sha = $1", [BLESSED])).rows[0].n, 1,
    "the main run deleted the blessed sha's rows");
  await db.close();
});
