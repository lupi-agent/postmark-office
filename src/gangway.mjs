// gangway.mjs — the town's arrivals breaker, READ FROM THE STORE (POS-353, 062).
//
// The gangway is the town's one lever on arrivals: `open` (the standing state,
// founder-ruled 2026-08-21) or `frozen` (the emergency posture, in which a
// residency request boards the ship instead of joining). It was the founder's
// file `HARBOR/GANGWAY.md`, opened live by every reader. The store is the
// record now (Darko, 2026-10-04): the state is the newest `gangway_acts` row,
// every reader asks `gangwayState()`, and the file is an export rendered from
// the store (tools/gangway-drain.mjs). A founder commit to the file is still
// honoured — the next drain adopts a state the store does not hold.
//
// ── THE ANSWERS ─────────────────────────────────────────────────────────────
//
//   not pointed at the record (no store: a test, a dev box) → "open": a town
//     with no record of a freeze has no freeze, which is what "no file" meant.
//   no rows → "open", the same.
//   the record pointed at and unreadable → THROWS. Every road that reads the
//     gangway to admit someone also needs the record to write the admission,
//     so the caller's own refusal ("the record cannot be reached, nothing was
//     written") is the honest answer; the join PAGE, which only words its
//     welcome, catches it.

import { actsQuery } from "./world2-acts.mjs";

export const GANGWAY_PATH = "HARBOR/GANGWAY.md";
export const GANGWAY_STATES = Object.freeze(["open", "frozen"]);

const ROW_SQL = "SELECT id, state, since, reason, by_who, actor_gh_id, source FROM gangway_acts";

const rowOf = (r) => r && ({
  id: Number(r.id), state: r.state, since: r.since, reason: r.reason ?? null,
  by: r.by_who, actorGhId: r.actor_gh_id == null ? null : Number(r.actor_gh_id), source: r.source,
});

// The refusal an unreadable record answers with: the same sentence every
// arrival road already speaks for its own record read (src/join-bind.mjs §
// BIND_REFUSALS.NO_RECORD), so an arrival hears one thing whichever read failed.
export const GANGWAY_UNREADABLE = Object.freeze({
  code: 503,
  defect: "the office cannot reach the town's record right now",
  hint: "nothing was written and no PR was opened: whether an arrival boards the ship or comes ashore is the gangway's, and the gangway is a row in the record. Try again in a minute.",
});

/** The newest row, `undefined` when there are none, `null` when not pointed at the record. */
export async function loadGangway(env = process.env) {
  let rows;
  try { rows = await actsQuery(`${ROW_SQL} ORDER BY id DESC LIMIT 1`, [], env); }
  catch (e) {
    throw Object.assign(new Error(GANGWAY_UNREADABLE.defect), { ...GANGWAY_UNREADABLE, cause: e });
  }
  if (rows === null) return null;
  return rowOf(rows[0]) ?? undefined;
}

/** "open" | "frozen", from the store (see § THE ANSWERS). */
export async function gangwayState(env = process.env) {
  const row = await loadGangway(env);
  return row?.state === "frozen" ? "frozen" : "open";
}

/** Append one state change. Answers the row, or null when not pointed at the record. */
export async function insertGangwayAct({ state, since, reason = null, by, actorGhId = null, source }, env = process.env) {
  if (!GANGWAY_STATES.includes(state)) throw new Error(`gangway state must be open or frozen, not ${state}`);
  const rows = await actsQuery(
    `INSERT INTO gangway_acts (state, since, reason, by_who, actor_gh_id, source)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, state, since, reason, by_who, actor_gh_id, source`,
    [state, since, reason, by, actorGhId, source], env);
  return rows === null ? null : rowOf(rows[0]);
}

// ── THE FILE ────────────────────────────────────────────────────────────────
//
// The parse is the readers' old one, kept whole (`state:` anywhere, first
// match; residency.mjs § gangwayState before POS-353), plus `since:`. The
// render rewrites only the frontmatter's `state:` and `since:` lines and keeps
// every other byte — the founder's prose is the town's to write.

/** `{ state, since }` from the file's text; `state` is "open" when the file names none. */
export function gangwayOfFile(text) {
  const src = String(text ?? "");
  const m = /\bstate:\s*([a-z]+)/.exec(src);
  const s = /^since:\s*(\d{4}-\d{2}-\d{2})\s*$/m.exec(src);
  return { state: m ? m[1] : "open", since: s ? s[1] : null };
}

/** The file the store renders: `fileText` with its state and since set from `row`. */
export function renderGangwayFile(fileText, row) {
  const src = String(fileText ?? "");
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(src);
  if (!fm) {
    const head = `---\nstate: ${row.state}\nsince: ${row.since}\nruled_by: founder\n---\n\n`;
    return head + (src || "# The gangway\n");
  }
  let body = fm[1];
  body = /^state:.*$/m.test(body) ? body.replace(/^state:.*$/m, `state: ${row.state}`) : `state: ${row.state}\n${body}`;
  body = /^since:.*$/m.test(body) ? body.replace(/^since:.*$/m, `since: ${row.since}`) : body.replace(/^(state:.*)$/m, `$1\nsince: ${row.since}`);
  return `---\n${body}\n---\n` + src.slice(fm[0].length);
}
