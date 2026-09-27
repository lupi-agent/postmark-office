// stance-pool-stub.mjs — the store's live claim layer, in memory, for the
// stance suites that used to seed the sqlite journal and read it back.
//
// NOT A TEST FILE. The suite glob is `test/*.test.mjs`, so this is a helper and
// not a roster entry — the same standing `registry-pool-stub.mjs` has.
//
// ── WHY THE STANCE SUITES SUDDENLY NEED ONE (POS-195, RULING 2) ─────────────
//
// `worldForStances` read the sqlite journal until 2026-09-22 and now reads
// `claims` through `stance_reader` (world2/schema/023_stance_reader.sql). Every
// test in `world-stance.test.mjs` plants its sketches with `appendJournal` and
// that intent is still exactly right — "a sketch exists, unpublished, on this
// ground" — so rather than rewrite twenty fixtures, this answers the store's
// query FROM THE SAME JOURNAL the test already wrote, shaped the way `claims`
// shapes a live row.
//
// ── IT HOLDS THE BODY, AND THAT IS THE POINT ────────────────────────────────
//
// A stub that simply omitted `body` would make the sentinel test a tautology:
// of course the derivation carries no draft body if the fixture never had one.
// The store DOES hold it — `claims.body` is a column, and `stance_reader` holds
// SELECT on the table, so it COULD be read.
//
// So this stub holds every row whole, body included, and PROJECTS the columns
// the query actually names — parsed out of the SQL's own select list. The
// derivation gets exactly what `stanceQuery`'s column list asks for and nothing
// else, which is what the real `stance_reader` connection would hand back.
//
// That is what makes both instruments able to fail:
//
//   · the SENTINEL test plants a body here and asserts it reaches no stance
//     arm's output — a real assertion, because the row it is hunting IS in the
//     store this stub is standing in for;
//   · the FLIP adds `body` to `STANCE_CLAIM_SELECT`, this stub starts returning
//     it (it has had it all along), and the sentinel goes red by name.
//
// A stub that answered a fixed shape could do neither.

import { openDynamic } from "../src/dynamic-store.mjs";
import { CLASS_MARK, liveMarks } from "../src/world-journal.mjs";
import { __setStancePoolForTest } from "../src/world2-acts.mjs";

/** The env that says "this office holds stance_reader's credential". */
export const STANCE_ON = Object.freeze({ WORLD2_STANCE_URL: "postgres://stub/none" });

/** Every column `claims` could hand this read, whether or not the query asks. */
const COLUMNS = Object.freeze(["slug", "claimant", "status", "at", "extent", "kind", "date", "declared_by", "body"]);

/**
 * Does this query's SELECT LIST name that column?
 *
 * Read off the SQL rather than configured, so the stub cannot drift from the
 * query it is answering: change `STANCE_CLAIM_SELECT` and this follows, which
 * is exactly what the flip needs.
 */
function selects(text, column) {
  const list = String(text).slice(0, String(text).search(/\bFROM\b/i));
  return new RegExp(`(\\bAS\\s+${column}\\b)|(^|[\\s,])${column}\\s*(,|$)`, "im").test(list);
}

/**
 * One 1.0 live mark → the `claims` row the store would hold for it.
 *
 * A live journal mark is an UNSTAKED sketch, so its status is `draft` — 007's
 * own lifecycle ("a claim is composed, submitted, and then ruled on"), and the
 * status the-late-welcome is about. A fixture wanting a submitted claim passes
 * `status` on the payload and it is honoured.
 */
const claimRowOf = (m) => ({
  slug: m.id,
  claimant: m.by ?? String(m.id).split("/")[0],
  status: m.status ?? "draft",
  at: m.at ?? null,
  extent: m.extent ?? null,
  kind: m.kind ?? null,
  date: m.date ?? null,
  declared_by: m.by ?? null,
  body: m.body ?? "",
});

/**
 * Point the stance read at the journal this test already seeds.
 *
 * Re-read on every query rather than snapshotted at install: the suites plant
 * marks INSIDE a test, after `beforeEach` ran, and a stub that froze the store
 * at install time would answer every one of them with an empty town.
 */
export function stancePoolFromJournal(dbPath) {
  const pool = {
    async query(text, params = []) {
      const db = openDynamic(dbPath);
      let marks;
      try { marks = liveMarks(db, { household: undefined }); }
      finally { try { db.close(); } catch { /* already gone */ } }

      const wanted = new Set(params[0] ?? ["draft", "pending"]);
      const rows = marks
        .map(claimRowOf)
        .filter((r) => wanted.has(r.status))
        .sort((a, b) => String(a.slug).localeCompare(String(b.slug)))
        .map((r) => {
          const out = {};
          for (const c of COLUMNS) if (selects(text, c)) out[c] = r[c];
          return out;
        });
      return { rows };
    },
    async end() { /* nothing to close */ },
  };
  __setStancePoolForTest(pool);
  return pool;
}

/** Put the module back the way it was found. */
export function clearStancePool() { __setStancePoolForTest(null); }

export { CLASS_MARK };
