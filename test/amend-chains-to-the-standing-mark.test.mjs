// amend-chains-to-the-standing-mark.test.mjs — an amendment of a PUBLISHED mark
// names the mark it amends (#2806, 2026-09-14).
//
//   node --test test/amend-chains-to-the-standing-mark.test.mjs
//
// THE INSTANCE. keith amended keith/the-garage on 2026-09-10 20:23:50Z (journal
// seq 1509). 1.0 canon published the amendment at the 09-11 05:45Z sweep. The
// store's clearing refused the same claim — "duplicate: a standing mark already
// carries this slug" — because the drain had set `supersedes` only to a pending
// claim of the same slug in the SAME window, and there was none: the mark it
// amended was standing, not pending. The clearing's own step 1 accepts an amend
// exactly when `supersedes` equals the standing mark's id (clearing-job.mjs:141),
// which is what 001_tables.sql says the column means. So the drain must name
// the standing mark when no in-window prior exists.
//
// THE RIG. `claimTxFromJournal` takes a client; this one is scripted. It answers
// each query by the shape of its SQL and records the UPDATE's parameters, so the
// assertion reads exactly what the store would have been told — no Postgres.

import { test } from "node:test";
import assert from "node:assert/strict";
import { claimTxFromJournal } from "../src/world2-claims.mjs";

function scriptedClient({ pendingPrior = null, standing = null } = {}) {
  const log = [];
  return {
    log,
    async query(sql, params = []) {
      const text = String(sql).replace(/\s+/g, " ");
      log.push({ text, params });
      if (text.startsWith("SELECT pg_advisory_xact_lock_shared(")) return { rows: [{}], rowCount: 1 }; // the candle's lock (POS-404)
      if (text.includes("FROM windows")) return { rows: [{ id: 188 }], rowCount: 1 };
      if (text.includes("FROM claims WHERE window_id") && text.includes("status = 'pending'"))
        return { rows: pendingPrior ? [{ id: pendingPrior }] : [], rowCount: pendingPrior ? 1 : 0 };
      if (text.includes("FROM marks WHERE slug") && text.includes("status = 'standing'"))
        return { rows: standing ? [{ id: standing }] : [], rowCount: standing ? 1 : 0 };
      if (text.startsWith("UPDATE claims SET status = 'retracted'"))
        return { rows: pendingPrior ? [{ id: pendingPrior }] : [], rowCount: pendingPrior ? 1 : 0 };
      if (text.startsWith("UPDATE claims SET")) return { rows: [{ id: "claim-new" }], rowCount: 1 };
      throw new Error(`unscripted query: ${text.slice(0, 80)}`);
    },
  };
}

const amendRow = () => ({
  action: "amend", actor: "keith", object: "keith/the-garage",
  payload: JSON.stringify({ slug: "the-garage", kind: "sited", by: "keith", body: "One bay door up.", put_forward: true }),
});

const supersedesSent = (client) => {
  const upd = client.log.find((q) => q.text.startsWith("UPDATE claims SET status = $12"));
  assert.ok(upd, "the drain reached the claim UPDATE");
  return upd.params[6]; // $7 = supersedes (world2-claims.mjs, the UPDATE's parameter list)
};

test("an amendment of a PUBLISHED mark names the standing mark as what it supersedes", async () => {
  const client = scriptedClient({ pendingPrior: null, standing: "mark-7a2f" });
  await claimTxFromJournal(client, amendRow(), 1509, { household: "noprotocol-keith" });
  assert.equal(supersedesSent(client), "mark-7a2f",
    "with no pending prior in the window, `supersedes` is the standing mark's id — the row the clearing's step 1 compares against");
  const lookup = client.log.find((q) => q.text.includes("FROM marks WHERE slug"));
  assert.deepEqual(lookup.params, ["keith/the-garage"], "the standing mark is looked up by the claim's own <by>/<slug>");
  // ⚑ THE FLIP: restore `supersedes = prior?.id ?? null` and this reads null —
  //   the exact row the candle refused as a duplicate on 2026-09-10.
});

test("a second amend in the window REPLACES the first: the prior is retracted, the new one supersedes the standing mark", async () => {
  // POS-241 ruling 1 (2026-09-26): "a second amend in one window replaces the first".
  // This test pinned the in-window chain before; the chain is what refused both of
  // wright's amends of furnish-ferrys-waiting-room at window 212.
  const client = scriptedClient({ pendingPrior: "claim-prior", standing: "mark-7a2f" });
  await claimTxFromJournal(client, amendRow(), 1510, { household: "noprotocol-keith" });
  const retract = client.log.find((q) => q.text.startsWith("UPDATE claims SET status = 'retracted'"));
  assert.ok(retract, "the prior pending claim is retracted at filing");
  assert.deepEqual(retract.params.slice(0, 3), [188, "keith/the-garage", "keith"], "this window, this mark, this author");
  assert.match(retract.params[3], /^replaced: /, "the row says why it ended");
  assert.equal(supersedesSent(client), "mark-7a2f", "the new claim supersedes the STANDING mark directly — no chain");
});

test("an amendment of a slug that stands nowhere supersedes nothing", async () => {
  const client = scriptedClient({ pendingPrior: null, standing: null });
  await claimTxFromJournal(client, amendRow(), 1511, { household: "noprotocol-keith" });
  assert.equal(supersedesSent(client), null, "a fresh slug amends nothing — null, exactly as before");
});

test("a plain leave (not an amend) never looks the standing mark up", async () => {
  const client = scriptedClient({ pendingPrior: null, standing: "mark-7a2f" });
  const row = { ...amendRow(), action: "leave-mark" };
  await claimTxFromJournal(client, row, 1512, { household: "noprotocol-keith" });
  assert.equal(supersedesSent(client), null);
  assert.ok(!client.log.some((q) => q.text.includes("FROM marks WHERE slug")), "the lookup is the amend branch's alone");
});
