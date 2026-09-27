// acts-pen-stub.mjs — the RECORD's write side, in memory, for suites that used
// to write a sqlite journal row.
//
// NOT A TEST FILE. The suite glob is `test/*.test.mjs`, so this is a helper and
// not a roster entry.
//
// ── WHY EVERY ACT-WRITING SUITE SUDDENLY NEEDS ONE (G1 / POS-156) ───────────
//
// `appendJournal` used to INSERT a sqlite row and queue a fire-and-forget copy
// into Postgres. G1 deleted the INSERT, and RULING 3 made what is left AWAITED
// and REFUSABLE — so a suite with no store no longer writes a row nobody reads,
// it gets `PenUnreachableError` and the door under test refuses.
//
// That is the correct behaviour and it is exactly what these suites must now be
// written against: the store IS the write, so a test that writes an act must
// point the office at a record. This is that record.
//
// ── IT IS A PEN, NOT A POSTGRES ────────────────────────────────────────────
//
// It answers the queries the WRITE path actually makes and nothing else:
// `officeWrite`'s transaction frame, `insertAct`'s one INSERT, and the three
// registry SELECTs `householdKeyFor` reaches through. A suite that also needs
// the docket (`claims`, `windows` — only mark-class rows go there,
// `claimEligible`) passes its own handlers in `also`.
//
// ⚑ AN UNKNOWN QUERY THROWS rather than answering `{ rows: [] }`. This is
// `test/stands-store-fixture.mjs`'s rule and it is the whole value of the
// thing: an empty answer to a question the stub does not understand is
// indistinguishable from "the record holds none", so a stub that shrugged
// would let a suite pass while the path under test asked for something nobody
// implemented. The throw names the SQL.
//
// ⚑ IT KEEPS WHAT IT WAS WRITTEN. `rows()` is the acts the suite's own door
// actually filed, in order, in the columns `insertAct` names — so an assertion
// can read back the thing that was written instead of trusting that a call
// returning no error wrote anything. `asked` counts every query, which is the
// leg an equality cannot supply: a door that quietly went back to sqlite would
// answer the same words and ask this pen NOTHING.

import { __setPoolForTest as __setActsPool } from "../src/world2-acts.mjs";
import { __setPoolForTest as __setPenPool } from "../src/world2-pen.mjs";
import { __clearHouseCache } from "../src/household-deriver.mjs";

/** The env that says "this office IS pointed at the record". */
export const RECORD_ON = Object.freeze({ WORLD2_PG: "1", WORLD2_PG_URL: "postgres://acts-pen-stub/none" });

/** And the env of an office pointed at none — the refusal's own control. */
export const RECORD_OFF = Object.freeze({ WORLD2_PG: undefined, WORLD2_PG_URL: undefined });

const norm = (sql) => String(sql).replace(/\s+/g, " ").trim();

/**
 * The pen itself.
 *
 * `households` / `pins` / `meta` seed the registry the household resolver folds
 * — empty by default, which resolves every handle to `solo:<handle>`, the same
 * answer an office with no registry gives. A suite that cares about house keys
 * seeds them; a suite that does not gets the honest default rather than a
 * fabricated house.
 *
 * `also` is `[[matcher, handler], …]`. `matcher` is a RegExp or a predicate over
 * the normalized SQL; `handler(sql, params, state)` returns a `pg` result. It is
 * consulted BEFORE the throw and AFTER the built-ins, so a suite can add the
 * docket without forking this file.
 */
export function makeActsPen({ households = [], pins = [], meta = [], claims = [], windows = [{ id: 1 }], marks = [], also = [], failOn = null } = {}) {
  const state = {
    acts: [],
    // THE DOCKET. Empty by default, and empty is an ANSWER here rather than a
    // shrug: a town whose docket holds nothing is a real state, and it is the
    // one most suites are in. What the pen must never do is answer a question
    // it does not model -- that is the throw at the foot of this function.
    claims: claims.map((c) => ({ ...c })),
    windows: windows.map((w) => ({ ...w })),
    asked: [],
    nextId: 1,
    committed: 0,
    rolledBack: 0,
    household: null,      // the last `app.household` declared, so a suite can assert the scoping happened
    householdKeys: [],    // and the spelling set declared beside it (POS-160 / #165)
  };

  const answer = async (sql, params = []) => {
    const q = norm(sql);
    state.asked.push(q);

    // ⚑ `failOn` IS CHECKED FIRST, and it has to be. `also` is consulted after
    // the built-ins, so a handler there can only answer a query this pen does
    // NOT implement -- it could never make an implemented one fail, which is
    // the thing a refusal test needs. A store that is REACHABLE and throws on
    // one statement is a different fact from a store nobody can reach, and it
    // is the fact RULING 3's "acts unchanged" is about.
    if (typeof failOn === "function" && failOn(q, params)) {
      throw new Error(`acts-pen-stub was told to fail this query: ${q.slice(0, 120)}`);
    }

    if (/^BEGIN/i.test(q)) return { rows: [], rowCount: 0 };
    if (/^COMMIT/i.test(q)) { state.committed += 1; return { rows: [], rowCount: 0 }; }
    if (/^ROLLBACK/i.test(q)) { state.rolledBack += 1; return { rows: [], rowCount: 0 }; }
    if (/set_config\('app\.household'/i.test(q)) { state.household = params[0] ?? null; return { rows: [], rowCount: 0 }; }
    // THE SPELLING SET, declared beside the household (POS-160 / #165): a house
    // may be spelled more than one way, and a guard scoped to one spelling
    // reads an empty live layer. Kept rather than shrugged at, so `declaredKeys`
    // reads back what was declared and a suite can assert the set was named.
    if (/set_config\('app\.household_keys'/i.test(q)) {
      state.householdKeys = params[0] == null || params[0] === "" ? [] : String(params[0]).split(",");
      return { rows: [], rowCount: 0 };
    }
    // THE PORT READS THE SETTINGS BACK before it trusts a household-scoped
    // query -- 007's row policy is declared per transaction, and a port that
    // assumed it had been declared would read another household's drafts the
    // one time it had not. Answering with what `set_config` was actually given
    // keeps that check honest rather than satisfying it.
    //
    // ⚑ IT ASKS FOR BOTH IN ONE STATEMENT (`guard-reads.mjs §
    // assertHouseholdDeclared`): `declared` AND `keys`, since POS-160 / #165
    // made the spelling SET the thing 024's policies compare against. A handler
    // that answered only `declared` returned a row whose `keys` was undefined,
    // and the guard read that as "(nothing)" and REFUSED -- correctly, on a
    // fixture's omission rather than on anything the office did.
    if (/current_setting\('app\.household'/i.test(q)) {
      return { rows: [{ declared: state.household, keys: state.householdKeys.length ? state.householdKeys : null }], rowCount: 1 };
    }

    // THE ONE INSERT THIS PEN EXISTS FOR. The column list is `insertAct`'s and
    // `mirrorAct`'s, in their order, and the id is assigned here because that is
    // what the sequence does — a caller reads it back as the act's receipt.
    if (/^INSERT INTO acts/i.test(q)) {
      // READ BY NAME off the statement's own column list, not by position:
      // since migration 027 a say's row names a fourteenth column (`nonce`),
      // and a positional read would file it as `journal_seq`.
      const cols = (/^INSERT INTO acts \(([^)]*)\)/i.exec(q)?.[1] ?? "").split(",").map((c) => c.trim());
      const { class: cls, journal_seq, nonce, ...rest } = Object.fromEntries(cols.map((c, i) => [c, params[i]]));
      const id = state.nextId++;
      state.acts.push({
        id, ...rest, class: cls,
        // ⚑ CARRIED SO ITS ABSENCE IS ASSERTABLE. G1 drops `acts.journal_seq`;
        // a suite proving the column is gone reads this and expects undefined,
        // which it cannot do if the stub silently omitted the field.
        ...(journal_seq === undefined ? {} : { journal_seq }),
        ...(nonce === undefined ? {} : { nonce }),
      });
      return { rows: [{ id }], rowCount: 1 };
    }

    // ── IT READS BACK WHAT IT WAS WRITTEN ────────────────────────────────
    //
    // Not a convenience: since G1 the door writes the record and the READ folds
    // that same record back, so a suite that could not read its own writes
    // could not test a round trip at all -- it would assert against a fixture
    // instead of against what the door did. `payload` and `witnesses` come back
    // as OBJECTS, which is what `pg` does with a jsonb column, so a reader that
    // forgot to parse a string here would not be flattered.
    //
    // The class filter is honoured because the callers pass one; an ORDER other
    // than `id` falls through to the throw rather than being quietly ignored.
    if (/^SELECT/i.test(q) && /FROM acts/i.test(q)) {
      if (/ORDER BY/i.test(q) && !/ORDER BY id/i.test(q)) {
        throw new Error(`acts-pen-stub only answers acts reads ordered by id; this one asks: ${q.slice(0, 200)}`);
      }
      const wantClass = /class = \$(\d+)/i.exec(q);
      // `action = $n` and `object = ANY($n)` are honoured too (POS-227, the
      // calendar's announcements): a filter the stub ignored would hand every
      // event act back as an announcement, and the reader would look right.
      const wantAction = /\baction = \$(\d+)/i.exec(q);
      const wantObjects = /\bobject = ANY\(\$(\d+)\)/i.exec(q);
      // The say's spent-nonce lookup (POS-265) asks by actor and nonce.
      const wantActor = /\bactor = \$(\d+)/i.exec(q);
      const wantNonce = /\bnonce = \$(\d+)/i.exec(q);
      const rows = state.acts
        .filter((r) => (wantClass ? r.class === params[Number(wantClass[1]) - 1] : true))
        .filter((r) => (wantAction ? r.action === params[Number(wantAction[1]) - 1] : true))
        .filter((r) => (wantObjects ? params[Number(wantObjects[1]) - 1].includes(r.object) : true))
        .filter((r) => (wantActor ? r.actor === params[Number(wantActor[1]) - 1] : true))
        .filter((r) => (wantNonce ? r.nonce === params[Number(wantNonce[1]) - 1] : true))
        .map((r) => ({
          ...r,
          at: r.at instanceof Date ? r.at : new Date(r.at),
          payload: typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload,
          witnesses: typeof r.witnesses === "string" ? JSON.parse(r.witnesses) : r.witnesses,
        }));
      return { rows, rowCount: rows.length };
    }

    // ── THE DOCKET, read and written ─────────────────────────────────────
    //
    // The door guards read `claims` since B1 and RULING 3a left them no second
    // place to look, so a suite that exercises a door needs this table even
    // when its own subject is elsewhere. The mark lane WRITES it too, on the
    // same client and in the same transaction as the act (R1).
    //
    // ⚑ THE READS REQUIRE `SELECT`, because "DELETE FROM claims" contains
    // "FROM claims" -- a matcher without it swallows the withdrawal's deletion
    // and answers it with a row list, so the draft stays on the docket and
    // nothing says so.
    if (/^SELECT/i.test(q) && /FROM windows/i.test(q)) {
      const open = state.windows[state.windows.length - 1];
      return { rows: open ? [{ id: open.id }] : [], rowCount: open ? 1 : 0 };
    }
    if (/^SELECT/i.test(q) && /FROM claims/i.test(q)) {
      // The amend's supersession lookup is a different question with different
      // arguments ("is there a PENDING claim for this slug in this window");
      // told apart by `window_id`, and answered honestly from the same rows.
      if (/window_id/i.test(q)) {
        const [, slug, claimant] = params;
        const hit = state.claims.filter((c) => c.status === "pending" && c.geometry?.slug === slug && c.claimant === claimant);
        return { rows: hit.slice(-1).map((c) => ({ id: c.id })), rowCount: hit.length ? 1 : 0 };
      }
      const [statuses, asked] = params;
      const want = Array.isArray(statuses) ? statuses : null;
      const rows = state.claims.filter((c) =>
        (want ? want.includes(c.status) : true) && (asked == null ? true : c.household === asked));
      return { rows: rows.map((c) => ({ ...c })), rowCount: rows.length };
    }
    // THE STANDING MARKS, for the one question the write path asks of them:
    // the amend's "what does this slug supersede" (`world2-claims.mjs` #2806,
    // `WHERE slug = $1 AND status = 'standing'`). Empty by default, which is
    // every suite's answer before POS-138 seeded one; any other read of
    // `marks` answers empty exactly as it always did.
    if (/^SELECT/i.test(q) && /FROM marks/i.test(q)) {
      if (/slug = \$1/i.test(q) && /status = 'standing'/i.test(q)) {
        const hit = marks.filter((m) => m.slug === params[0] && (m.status ?? "standing") === "standing").slice(0, 1);
        return { rows: hit.map((m) => ({ id: String(m.id) })), rowCount: hit.length };
      }
      // THE CALENDAR'S PLACE READ (POS-207, events-store.mjs § placeFor): one
      // slug, ANY status, with its geometry — a retired mark must come back as
      // retired for the door to refuse it by name, so this does not filter.
      if (/slug = \$1/i.test(q) && /geometry/i.test(q) && !/status = 'standing'/i.test(q)) {
        const hit = marks.filter((m) => m.slug === params[0]).slice(0, 1);
        return { rows: hit.map((m) => ({ slug: m.slug, status: m.status ?? "standing", kind: m.kind ?? "sited", geometry: m.geometry ?? null })), rowCount: hit.length };
      }
      return { rows: [], rowCount: 0 };
    }
    if (/^INSERT INTO claims/i.test(q)) {
      const [, kind, claimant, household, body, geometry, bbox, stake, supersedes, data, slug, status] = params;
      const row = { id: `claim-${state.claims.length + 1}`, slug, class: kind, claimant, household, status, body,
        geometry: typeof geometry === "string" ? JSON.parse(geometry) : geometry,
        bbox, stake, supersedes, data, submitted_at: new Date() };
      state.claims.push(row);
      return { rows: [{ id: row.id }], rowCount: 1 };
    }
    // ⚑ THE HOUSEHOLD IS A SPELLING SET (POS-160 / #165): the withdraw's DELETE
    // is `household = ANY($3)`, and $3 is `declaredKeys`' array -- a house may
    // be spelled more than one way and a draft under any of its spellings is
    // still its draft. Comparing against a scalar matches none of them.
    if (/^DELETE FROM claims/i.test(q)) {
      const [slug, claimant, households] = params;
      const keys = Array.isArray(households) ? households : [households];
      const before = state.claims.length;
      state.claims = state.claims.filter((c) =>
        !(c.status === "draft" && c.slug === slug && c.claimant === claimant && keys.includes(c.household)));
      return { rows: [], rowCount: before - state.claims.length };
    }
    // `declaredKeys` asks the session for the house's spellings; null means the
    // client has none and the caller falls back to the one key it was given.
    if (/current_setting\('app\.household_keys'/i.test(q)) {
      return { rows: [{ keys: state.householdKeys.length ? state.householdKeys : null }], rowCount: 1 };
    }
    if (/^UPDATE claims/i.test(q)) return { rows: [], rowCount: 0 };

    // The registry, as `registry-store.mjs`'s three fixed SELECTs ask for it.
    if (/FROM households/i.test(q)) return { rows: households.map((r) => ({ ...r })), rowCount: households.length };
    if (/FROM household_pins/i.test(q)) return { rows: pins.map((r) => ({ ...r })), rowCount: pins.length };
    if (/FROM registry_meta/i.test(q)) return { rows: meta.map((r) => ({ ...r })), rowCount: meta.length };

    for (const [matcher, handler] of also) {
      const hit = typeof matcher === "function" ? matcher(q, params) : matcher.test(q);
      if (hit) return handler(q, params, state);
    }

    throw new Error(
      `acts-pen-stub was asked a query it does not implement, and answering [] would be a lie: ${q.slice(0, 200)}`);
  };

  const client = { query: answer, release() { /* pooled in name only */ } };

  return {
    state,
    /** The acts this pen actually received, in write order. */
    rows: () => state.acts.map((r) => ({ ...r })),
    /**
     * Put a row in the record WITHOUT a door writing it — for the suites whose
     * subject is a READER of `acts` and that need history the door in this test
     * did not make (a drained window, another household's act, a prior era).
     *
     * ⚑ NAMED `seedAct` SO IT CANNOT BE MISTAKEN FOR A WRITE. Nothing that uses
     * it may assert that a door filed the row; the door's own writes are what
     * `rows()` returns and they arrive through `insertAct` like any other.
     */
    seedAct(row) {
      const id = row.id ?? state.nextId++;
      if (row.id != null && row.id >= state.nextId) state.nextId = row.id + 1;
      // ⚑ NO `journal_seq` IN THE DEFAULTS. G1 drops that column and the pen
      // stopped sending it, so a row the real INSERT wrote does not carry the
      // key at all. Seeding it here would make a seeded copy of a written row
      // unequal to the row it copied -- which is exactly what a test comparing
      // the record before and after a refused write is looking at.
      state.acts.push({ crossing: null, object: null, at_anchor: null, at_dx: null, at_dy: null,
        witnesses: null, effect: null, household: null, ...row, id });
      return id;
    },
    /** Every query asked of it, normalized — assert the count, not only the answer. */
    asked: () => [...state.asked],
    /** The docket, as it stands after whatever the door did to it. */
    claims: () => state.claims.map((c) => ({ ...c })),
    query: answer,
    connect: async () => client,
    end: async () => {},
  };
}

/**
 * Point the office at a fresh pen for the length of one test, and hand it back.
 *
 * ⚑ THE HOUSE CACHE IS CLEARED BOTH WAYS. `houseOfVia` memoizes per queryable
 * AND `houseOf` memoizes per process; a suite that installs a second pen in the
 * same process would otherwise resolve handles against the first one's
 * registry. `household-deriver.mjs` exports the drop for exactly this.
 */
export function installActsPen(opts = {}) {
  const pen = makeActsPen(opts);
  __clearHouseCache();
  // BOTH POOLS, and the two are not the same object in the office either:
  // `world2-acts.mjs` holds the mirror's (the arena's path, `mirrorAct`) and
  // `world2-pen.mjs` holds the awaited pen's (`penWrite`, which is every other
  // door since G1). A suite that set only one would write through whichever
  // path it did not stub and reach a real socket.
  __setActsPool(pen);
  __setPenPool(pen);
  return pen;
}

/** Drop the pen and the caches with it. A suite's `after` calls this. */
export function uninstallActsPen() {
  __setActsPool(null);
  __setPenPool(null);
  __clearHouseCache();
}

/**
 * Set the record env for a block and put it back — the two-line shape every
 * suite here was writing by hand.
 */
export async function withRecordOn(fn) {
  const was = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
  process.env.WORLD2_PG = RECORD_ON.WORLD2_PG;
  process.env.WORLD2_PG_URL = RECORD_ON.WORLD2_PG_URL;
  try { return await fn(); }
  finally {
    if (was.pg == null) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = was.pg;
    if (was.url == null) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = was.url;
  }
}
