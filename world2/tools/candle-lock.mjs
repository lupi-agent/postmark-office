// candle-lock.mjs — THE CANDLE'S LOCK: the clearing and the claim door take turns
// (POS-404, postmark-office#349).
//
// THE RACE IT CLOSES. The door read the open window with no lock. While the
// clearing held window N, the door still saw N as open; its INSERT's foreign-key
// check waited on the clearing's row lock and then wrote into N after N had
// closed. The clearing had read its pending list before the claim existed, the
// next clearing reads only its own window, and the docket view hides closed
// windows, so the claim stayed pending for good and was never judged. A stake
// promoting a draft composed in the same window had no wait at all: an UPDATE
// that leaves `window_id` alone makes no key check.
//
// THE SHAPE. One transaction-scoped advisory lock with two modes:
//   · the clearing takes it EXCLUSIVE as its transaction's first statement,
//     before it locks the window, and holds it to COMMIT;
//   · the door takes it SHARED before it reads the open window, and holds it to
//     its own COMMIT.
// A door that arrives during a clearing waits, and its window read (the next
// statement, a fresh snapshot under READ COMMITTED) sees the window the clearing
// opened. A clearing that arrives during a door's filing waits for that door, and
// its pending read then sees the claim. Doors share, so they never wait on each
// other.
//
// WHY NOT THE WINDOW'S OWN ROW LOCK. `SELECT … FOR SHARE` (or FOR KEY SHARE) on
// `windows` needs UPDATE privilege on the table, and `office_api` has none:
// 002_grants.sql gives `windows` one writer, `clearing_job`. Measured on embedded
// Postgres 2026-10-05: "permission denied for table windows". And even with the
// grant, the locked read returns NO row after the wait, because Postgres
// re-checks the locked row (now closed) and the window opened by the clearing is
// not in that statement's snapshot. The advisory functions need no grant.
//
// Imports nothing: the clearing and the office both read these two lines.

export const CANDLE_LOCK_KEY = "world2:candle";

/** The clearing's first statement: no door is filing, and none starts, until COMMIT. */
export const CLEARING_TAKES_THE_CANDLE = `SELECT pg_advisory_xact_lock(hashtext('${CANDLE_LOCK_KEY}'))`;

/** The door's, before it reads the open window: no clearing is running, and none starts, until COMMIT. */
export const DOOR_SHARES_THE_CANDLE = `SELECT pg_advisory_xact_lock_shared(hashtext('${CANDLE_LOCK_KEY}'))`;
