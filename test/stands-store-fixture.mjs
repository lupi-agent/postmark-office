// stands-store-fixture.mjs — a hand-built `acts` client for the investigate
// door's `stands` block (POS-162).
//
// The door's two reads go through `world2-guards.mjs § standsRowsFromStore`,
// which takes its client from `reading()` — and `useGuardReader` is the seam
// that swaps it (`test/world-journal.test.mjs` uses the same one for B1). So a
// falsifier can put a holding record in front of the real door with no
// Postgres, no world2 schema and no flag.
//
// ⚑ IT COUNTS WHAT IT WAS ASKED. `asked` is the leg an equality cannot supply:
// a door that quietly went back to sqlite would answer the same words off a
// fixture sqlite store and ask this client NOTHING. Assert the count, not only
// the answer.
//
// ⚑ AN UNKNOWN QUERY THROWS rather than answering `{rows: []}`. An empty answer
// to a question the fixture does not understand is indistinguishable from "the
// record holds none", which is the one confusion a holder question may not have.

import { randomUUID } from "node:crypto";

/**
 * One `acts` row as the live holding pen writes it — `holdingEntry`'s own shape,
 * flattened into the columns `mirrorAct` and `insertAct` name in their INSERTs.
 *
 * `at` is THREE COLUMNS. The witnessed line has never lived in `payload`, on
 * either side of the seam; writing the fixture the payload way would make every
 * assertion below agree with a port that reads a key nothing writes.
 */
export const holdingAct = ({
  id, at, actor, action, thing, holder = null, previous_holder = null,
  made_by = "wright", policy = null, anchor = null, dx = null, dy = null, household = null,
}) => ({
  id,
  at: new Date(at),
  actor,
  action,
  object: thing,
  at_anchor: anchor,
  at_dx: dx,
  at_dy: dy,
  class: "holding",
  payload: { thing, holder, previous_holder, made_by, policy: policy ?? (action === "drop" ? "detach" : "cascade") },
  household,
  witnesses: { source: "presence", list: [] },
});

/** A `legacy:attachment` act — the frozen STATE/log era, which `attachmentRowOf` reads by its inner payload. */
export const legacyAttachmentAct = ({ id, at, actor, thing, policy, seq }) => ({
  id,
  at: new Date(at),
  actor,
  action: "legacy:attachment",
  object: null,
  at_anchor: null, at_dx: null, at_dy: null,
  class: "holding",
  payload: { type: "attachment", at, seq, actor, payload: { target: thing, policy, declared_by: actor } },
  household: null,
  witnesses: null,
});

/**
 * A client `officeRead`'s contract is satisfied by: it answers the two reads the
 * door makes and refuses everything else.
 *
 * `acts` is the whole record; the two queries filter it the way the real SQL
 * does, so the ORDER and the PREDICATE are exercised here rather than assumed.
 */
export function actsClient(acts = []) {
  const asked = [];
  return {
    asked,
    async query(sql, params = []) {
      const text = String(sql).replace(/\s+/g, " ").trim();
      asked.push({ sql: text, params });
      if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(text)) return { rows: [] };

      // pgAttachmentsFor — `action = ANY($1)`, optionally narrowed to a target,
      // ordered by ATTACHMENT_ORDER_SQL (born_at, then era, then the era's own
      // tiebreak). The fixture sorts by born_at alone and then by id, which is
      // the same order over rows whose born_at are distinct — and they are,
      // deliberately, so the fixture never decides a tie the real clause owns.
      if (/FROM acts WHERE action = ANY\(\$1\)/i.test(text)) {
        const [actions, target] = params;
        const bornAt = (a) => (a.action === "legacy:attachment" ? a.payload.at : a.at.toISOString());
        return { rows: acts
          .filter((a) => actions.includes(a.action))
          .filter((a) => target == null || (a.payload?.payload?.target ?? a.payload?.thing) === target)
          .sort((x, y) => Date.parse(bornAt(x)) - Date.parse(bornAt(y)) || x.id - y.id) };
      }

      // pgHoldingRows — `class = $1`, then the thing and/or the makers, each
      // at the placeholder the TEXT names, ordered `(at, id)`. Read from the
      // text rather than a fixed slot (POS-138, 2026-09-24): a fixture that
      // took `params[1]` as the thing answered green while the real clause
      // said `= 2` and Postgres refused it. A thing clause with no `$n` is
      // refused here too.
      if (/FROM acts WHERE class = \$1/i.test(text)) {
        const cls = params[0];
        const thingAt = /payload->>'thing'\) = (\S+)/i.exec(text);
        if (thingAt && !/^\$\d+$/.test(thingAt[1]))
          throw new Error(`the thing clause names no parameter: "= ${thingAt[1]}" — Postgres refuses this`);
        const thing = thingAt ? params[Number(thingAt[1].slice(1)) - 1] : undefined;
        const makersAt = /split_part\(COALESCE\(object, payload->>'thing'\), '\/', 1\) = ANY\(\$(\d+)\)/i.exec(text);
        const makers = makersAt ? params[Number(makersAt[1]) - 1] : undefined;
        const idOf = (a) => a.object ?? a.payload?.thing;
        return { rows: acts
          .filter((a) => a.class === cls)
          .filter((a) => thing === undefined || idOf(a) === thing)
          .filter((a) => makers === undefined || makers.includes(String(idOf(a)).split("/")[0]))
          .sort((x, y) => x.at - y.at || x.id - y.id) };
      }

      throw new Error(`the hand-built acts store was asked something it does not know: ${text.slice(0, 120)}`);
    },
  };
}

/**
 * Run `fn(client)` with the register configured, the reader replaced, and both
 * restored afterwards — whatever `fn` does.
 *
 * `WORLD2_PG_URL` is never dialled: `useGuardReader` replaces the road before
 * `officeRead` would reach a pool. It is set because `world2Enabled()` reads it,
 * and the door's "the register was not asked" arm is a different case with its
 * own test.
 */
export async function withActs(acts, fn) {
  const guards = await import("../src/world2-guards.mjs");
  const prev = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = `postgres://stands-store-fixture/${randomUUID()}`;
  const client = actsClient(acts);
  // ⚑ HOW MANY TIMES THE ROAD WAS TAKEN. `useGuardReader` REPLACES `officeRead`
  // whole, so a fixture client never sees a `BEGIN READ ONLY` and an assertion
  // about one here would be measuring the fixture, not the office. What this
  // seam CAN see is how many times the door asked for a client: one call is one
  // transaction (officeRead wraps each in its own), two would be two snapshots
  // with the town free to move between them.
  client.reads = 0;
  const restore = guards.useGuardReader((run) => { client.reads += 1; return run(client); });
  try { return await fn(client); }
  finally {
    restore();
    for (const [k, v] of [["WORLD2_PG", prev.pg], ["WORLD2_PG_URL", prev.url]])
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}
