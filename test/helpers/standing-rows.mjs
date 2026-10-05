// standing-rows.mjs — plant standing acts in a test's store (POS-347).
//
// The standing ledger is a store table now (060_standing_acts.sql), so a test
// that used to write `tools/standing-ledger.md` into a temp clone appends rows
// instead. Appending is the real semantics: the newest act on a handle is its
// standing, so "quarantine, then lift" is two rows, exactly as it is two lines.
//
//   await plantStanding(store, Q("wright"), LIFT("wright"))   // ledger lines
//   await resetStanding(store)                                 // a clean ledger
//
// `store` is a startStore() handle (test/helpers/embedded-store.mjs). Rows go in
// as `office_api`, the table's one pen; the reset is the owner's TRUNCATE, which
// the append-only trigger (a row trigger) does not see.

import { parseStandingLine } from "../../src/standing.mjs";

export async function plantStanding(store, ...lines) {
  const c = await store.connect("office_api");
  try {
    for (const line of lines) {
      const r = parseStandingLine(line);
      if (!r) throw new Error(`not a standing line: ${line}`);
      await c.query(
        `INSERT INTO standing_acts (date, act, handle, by_who, founder_word, reason, line, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'door')`,
        [r.date, r.act, r.handle, r.by, r.founderWord, r.reason, r.line]);
    }
  } finally { await c.end(); }
}

export async function resetStanding(store) {
  const c = await store.connect("world2_owner");
  try { await c.query("TRUNCATE standing_acts"); } finally { await c.end(); }
}

/**
 * The store a spawned office reads standing from: the index store's own, or —
 * when the suite's index is forced back to office.db (OFFICE_TEST_INDEX=office)
 * and there is none — a store of its own, pointed at through `ix.env`. Answers
 * `{ store, stop }`.
 */
export async function standingStoreFor(ix) {
  if (ix?.store) return { store: ix.store, stop: async () => {} };
  const { startStore } = await import("./embedded-store.mjs");
  const store = await startStore({ db: "standing_rows" });
  Object.assign(ix.env, { WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api") });
  return { store, stop: () => store.stop() };
}
