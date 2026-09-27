// jsonb-key-order.mjs — what Postgres does to an object's keys, in JavaScript.
//
// NOT A TEST FILE. The suite glob is `test/*.test.mjs`, so this is a helper and
// not a roster entry. It is TEST-SIDE ON PURPOSE: nothing in `src/` may depend
// on it, because it exists to make a pure test meet a property of the database
// that a pure test otherwise cannot see.
//
// ── THE RULE, NAMED ─────────────────────────────────────────────────────────
//
// Postgres `jsonb` does not store an object. It stores a SORTED MAP: on the way
// in, every object's keys are ordered by LENGTH IN BYTES FIRST, then BYTEWISE,
// and they come back out that way forever. Insertion order is not kept and is
// not recoverable from the column. `src/state-log-from-store.mjs § the three
// things` names the same property for `acts.payload`, and it is the reason
// `PAYLOAD_ORDER` there says "not recoverable from jsonb".
//
// For `{ login, id }` — the shape every one of the registry's 121 accounts
// wears — the two orders do NOT coincide: `id` is 2 bytes and `login` is 5, so
// the store hands back `{ id, login }` and a renderer that emits the stored
// order writes `"id": 306985727,` where the town's file has
// `"login": "vertas-marginalia",`. That is the red the dev sandbox printed at
// `tools/households.json` line 9 on 2026-09-22, and the pure suite could not
// see it because a JavaScript stub keeps an object whole.
//
// ── WHY THE TESTS REACH FOR THIS RATHER THAN A REAL POSTGRES ────────────────
//
// The round-trip law is enforced in two places: `tools/registry-drain.mjs
// --check` against the live clone on the box, and `test/registry-rows.test.mjs`
// against the town's real 2026-09-22 bytes here. The second one is the gate a
// lane meets in under a second, and it is worthless if it models a store that
// behaves better than the store. So both the pure test's `asPostgresReturns`
// and `test/registry-pool-stub.mjs`'s reads put every jsonb value through this
// on the way OUT, and the tests then see what the box sees.

/** The comparator itself: length in bytes, then bytes. Nothing else. */
export function compareJsonbKeys(a, b) {
  const ab = Buffer.from(String(a), "utf8");
  const bb = Buffer.from(String(b), "utf8");
  if (ab.length !== bb.length) return ab.length - bb.length;
  return Buffer.compare(ab, bb);
}

/**
 * A value as `jsonb` would hand it back: every object's keys re-sorted, at
 * every depth, arrays and scalars otherwise untouched.
 *
 * ARRAY ORDER IS PRESERVED, because jsonb preserves it — a jsonb array is a
 * list and only an OBJECT is a sorted map. `households.accounts` relies on
 * that: 019's own header says "the ORDER of the array is part of the file's
 * bytes", and a helper that sorted arrays too would quietly relax the very
 * thing this one exists to tighten.
 */
export function asJsonbReturns(value) {
  if (Array.isArray(value)) return value.map(asJsonbReturns);
  if (value === null || typeof value !== "object") return value;
  const out = {};
  for (const k of Object.keys(value).sort(compareJsonbKeys)) out[k] = asJsonbReturns(value[k]);
  return out;
}
