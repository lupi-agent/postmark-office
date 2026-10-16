// whole-number.mjs — the one place a caller's `limit` / `offset` becomes a number.
//
// The pagers all read `Math.max(Number(x) || default, floor)`. That keeps NaN
// out and nothing else: 2.5 and 1e30 survive. SQLite refuses a fractional
// LIMIT/OFFSET ("datatype mismatch") and Postgres binds both as bigint, so
// "2.5" and "1e+30" are not integers to it. The town index answers reads from
// Postgres, and the door said "nothing in your request caused it" (500) to
// `GET /stamps?limit=2.5`. A page size is a count of rows: floor it, and cap it
// at what a JS number can carry exactly, so 1e30 and Infinity read as "past
// the end" instead of tripping the store. NaN and non-numbers read as 0, which
// every caller's `|| default` then replaces, exactly as before.
export function wholeNumber(v) {
  const n = Math.floor(Number(v));
  if (Number.isNaN(n)) return 0;
  return Math.min(n, Number.MAX_SAFE_INTEGER);
}
