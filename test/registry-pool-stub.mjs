// registry-pool-stub.mjs — the store, in memory, for suites that used to seed a file.
//
// NOT A TEST FILE. The suite glob is `test/*.test.mjs`, so this is a helper and
// not a roster entry.
//
// ── WHY EVERY DRAIN SUITE SUDDENLY NEEDS ONE (POS-158) ──────────────────────
//
// The household registry is store-of-record (019_households.sql, POS-187), and
// POS-158 moved the last office readers and the last office writers onto it.
// `planTownDrain` reads `loadRegistry()`; `writeTownDrain` writes rows through
// `src/ceremony.mjs` and renders the files through `tools/registry-drain.mjs`.
//
// These suites were all written against the OLD shape: seed
// `tools/households.json` in a temp clone, run a crossing, read the file back.
// That intent is still exactly right — a crossing reads the town's registry and
// leaves it holding one more resident — so rather than rewrite twenty tests,
// this seeds THE STORE from the same fixture the test already wrote, and the
// file it wrote is then what the drain renders back.
//
// THE POOL IS STUBBED, NOT MOCKED AROUND. `world2-acts.mjs` exports
// `__setPoolForTest` for exactly this (it is how `registry-drain.test.mjs` has
// worked since POS-187), and this stub answers the REAL queries with rows
// shaped the way `node-postgres` shapes them: `gh_id` a STRING for a bigint,
// `ord` a number, and `accounts` parsed jsonb WITH ITS KEYS SORTED THE WAY
// JSONB SORTS THEM — see the reads below and `test/jsonb-key-order.mjs`. So the
// path under test stays the real `loadRegistryRows` -> `registryFromRows` ->
// the ceremony -> the drain, over the values the real column hands back.
//
// IT APPLIES THE WRITES. A stub that answered reads and swallowed upserts would
// let "the crossing settled them" pass while nothing was settled. The rows go
// into the same arrays the reads come out of, which is what makes a suite's
// "read it back" assertion mean something.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { __setPoolForTest } from "../src/world2-acts.mjs";
import { rowsFromRegistry } from "../src/registry-rows.mjs";
import { REGISTRY_PATH, PINS_PATH } from "../src/residency.mjs";
import { asJsonbReturns } from "./jsonb-key-order.mjs";

/** The env that says "this office IS pointed at the record". */
export const RECORD_ON = Object.freeze({ WORLD2_PG: "1", WORLD2_PG_URL: "postgres://stub/none" });

const readJson = (clone, rel) => {
  try { return JSON.parse(readFileSync(join(clone, rel), "utf8")); } catch { return null; }
};

/**
 * Seed the store from whatever two registers a clone already holds.
 *
 * A clone with no registry seeds an EMPTY store rather than no store — which is
 * the truthful translation of the old `?? { households: {} }`: the office can
 * look, and there is nothing there. "Cannot look" is a different fact and it is
 * reached by not calling this at all.
 */
export function poolFromClone(clone) {
  const households = readJson(clone, REGISTRY_PATH) ?? { schema_version: 1, households: {} };
  const pins = readJson(clone, PINS_PATH) ?? {};

  let seed;
  try {
    seed = rowsFromRegistry(households, pins);
  } catch {
    // A fixture carrying a key the columns do not cover. `rowsFromRegistry`
    // throws on purpose there (it would otherwise render a file that drops
    // somebody's field), and a helper must not paper over it — but a suite
    // proving something else entirely should not fail on it either, so it
    // starts empty and the suite's own assertions say whether that mattered.
    seed = { meta: { schema_version: 1 }, households: [], pins: [] };
  }
  return makePool(seed);
}

/** The in-memory pool itself, over a `rowsFromRegistry`-shaped seed. */
export function makePool(seed) {
  const state = {
    households: seed.households.map((r) => ({ ...r })),
    pins: seed.pins.map((r) => ({ ...r })),
    meta: { ...seed.meta },
    writes: { households: 0, pins: 0 },
    // THE WORLD'S HALF, for the ceremony's adoption (POS-212). A suite that
    // seeds only the registry holds no marks, and "no marks" is then the TRUE
    // answer to the adoption's read rather than a kindness — the store it
    // stands in for would say the same. `test/solo-adoption.test.mjs` seeds
    // marks and an open window and reads back what the one statement wrote.
    marks: (seed.marks ?? []).map((m) => ({ ...m })),
    claims: (seed.claims ?? []).map((c) => ({ ...c })),
    acts: (seed.acts ?? []).map((a) => ({ ...a })),
    windows: (seed.windows ?? []).map((w) => ({ ...w })),
  };
  return {
    state,
    async query(text, params = []) {
      // THE MINT'S OWN INSERT, which lets the DATABASE choose the place
      // (`src/registry-store.mjs` § A NEW HOUSE TAKES ITS PLACE FROM THE
      // DATABASE). The stub computes it the same way the statement does, and
      // enforces the UNIQUE index, so a test that races two mints meets the
      // real constraint rather than a kindness.
      if (/^\s*INSERT INTO households \(ord,/.test(text)) {
        state.writes.households++;
        const ord = state.households.reduce((hi, r) => Math.max(hi, Number(r.ord) + 1), 0);
        if (state.households.some((r) => Number(r.ord) === ord))
          throw new Error(`duplicate key value violates unique constraint "households_ord_key"`);
        const row = {
          slug: params[0], ord, name: params[1], human: params[2],
          accounts: JSON.parse(params[3]), residents: params[4] ?? [], since: params[5],
          member_of: params[6], declared_by: params[7], formerly: params[8] ?? [],
          provisional: params[9] === true,
        };
        if (state.households.some((r) => r.slug === row.slug))
          throw new Error(`duplicate key value violates unique constraint "households_pkey"`);
        state.households.push(row);
        return { rows: [{ ord }] };
      }
      if (/^\s*INSERT INTO households/.test(text)) {
        state.writes.households++;
        const row = {
          slug: params[0], ord: Number(params[1]), name: params[2], human: params[3],
          accounts: JSON.parse(params[4]), residents: params[5] ?? [], since: params[6],
          member_of: params[7], declared_by: params[8], formerly: params[9] ?? [],
          provisional: params[10] === true,
        };
        const at = state.households.findIndex((r) => r.slug === row.slug);
        if (at >= 0) state.households[at] = row; else state.households.push(row);
        return { rows: [] };
      }
      if (/^\s*INSERT INTO household_pins/.test(text)) {
        state.writes.pins++;
        const row = {
          handle: params[0], login: params[1], gh_id: params[2], pinned: params[3],
          renamed: params[4], note: params[5], retired: params[6], renamed_to: params[7],
        };
        const at = state.pins.findIndex((r) => r.handle === row.handle);
        if (at >= 0) state.pins[at] = row; else state.pins.push(row);
        return { rows: [] };
      }
      // THE CHOOSE-ONCE UPDATE (POS-159). A rename is an UPDATE because no pen
      // in this store holds DELETE and `slug` is the primary key. The stub
      // answers it the way the statement does: zero rows when nothing held the
      // old key, and the row's own `ord` — untouched — when one did.
      if (/^\s*UPDATE households/.test(text)) {
        state.writes.households++;
        const [to, formerly, provisional, name, from] = params;
        const at = state.households.findIndex((r) => r.slug === from);
        if (at < 0) return { rows: [] };
        if (to !== from && state.households.some((r) => r.slug === to))
          throw new Error(`duplicate key value violates unique constraint "households_pkey"`);
        state.households[at] = {
          ...state.households[at], slug: to, formerly: formerly ?? [],
          provisional: provisional === true, name: name ?? null,
        };
        return { rows: [{ slug: to, ord: state.households[at].ord }] };
      }
      // ── THE READS, AND THE JSONB REORDER THEY CARRY ───────────────────────
      //
      // `accounts` is a `jsonb` column, and a stub that handed the JS object
      // back whole would be a store that behaves BETTER than Postgres. It did,
      // until 2026-09-22: every registry suite was green while the dev sandbox
      // printed `tools/households.json differs at line 9 — store renders
      // "id": 306985727, / the clone has "login": "vertas-marginalia",`, because
      // jsonb sorts an object's keys by (length, bytes) on the way in and these
      // reads never sorted anything. `asJsonbReturns` is that rule, named once
      // in `test/jsonb-key-order.mjs`, and every registry suite now reads what
      // the box reads.
      if (/FROM households/.test(text))
        return { rows: [...state.households].sort((a, b) => a.ord - b.ord).map((r) => ({ ...r, ord: Number(r.ord), accounts: asJsonbReturns(r.accounts) })) };
      if (/FROM household_pins/.test(text))
        return { rows: [...state.pins].sort((a, b) => (a.handle < b.handle ? -1 : 1)).map((r) => ({ ...r, gh_id: String(r.gh_id) })) };
      if (/FROM registry_meta/.test(text))
        return { rows: Object.entries(state.meta).map(([key, value]) => ({ key, value: asJsonbReturns(value) })) };
      // ── THE ADOPTION'S STATEMENTS (src/solo-adoption.mjs), answered as they read ──
      if (/FROM marks\s+WHERE status = 'standing' AND household LIKE 'solo:%'/.test(text))
        return { rows: state.marks.filter((m) => m.status === "standing" && String(m.household).startsWith("solo:")).map((m) => ({ ...m })) };
      if (/FROM marks\s+WHERE status = 'standing' AND kind = 'parcel' AND household NOT LIKE 'solo:%'/.test(text))
        return { rows: state.marks.filter((m) => m.status === "standing" && m.kind === "parcel" && !String(m.household).startsWith("solo:")).map((m) => ({ ...m })) };
      if (/SELECT supersedes::text AS id FROM claims/.test(text))
        return { rows: state.claims.filter((c) => c.status === "pending" && c.supersedes != null && c.data?._adopted).map((c) => ({ id: String(c.supersedes) })) };
      if (/^\s*WITH open_window AS/.test(text)) {
        // One statement: the act only if a window is open AND a mark is still
        // eligible, then one pending claim per eligible mark — every column read
        // off the mark, exactly as the SQL does.
        const [actor, key, payload, effect, ids] = params;
        const win = state.windows.filter((w) => w.status === "open").sort((a, b) => b.id - a.id)[0];
        const eligible = state.marks.filter((m) => ids.includes(String(m.id)) && m.status === "standing"
          && String(m.household).startsWith("solo:")
          && !state.claims.some((c) => c.status === "pending" && String(c.supersedes) === String(m.id) && c.data?._adopted));
        if (!win || !eligible.length) return { rows: [] };
        const act = { id: state.acts.length + 1, actor, action: "adopt", object: key, class: "household",
          payload: JSON.parse(payload), effect, household: key };
        state.acts.push(act);
        const out = [];
        for (const m of eligible) {
          const id = `adopt-${state.claims.length + 1}`;
          state.claims.push({
            id, window_id: win.id, class: m.kind, claimant: m.owner, household: key, body: m.body,
            geometry: m.geometry, bbox: m.bbox, stake: 0, supersedes: m.id, parent: m.parent ?? null,
            data: { ...(m.data ?? {}), _adopted: { from: m.household, to: key, at: "ceremony" }, _act_id: String(act.id) },
            slug: m.slug, status: "pending",
          });
          out.push({ id, slug: m.slug });
        }
        return { rows: out };
      }
      throw new Error(`the stub pool was asked something it does not answer: ${text}`);
    },
  };
}

/**
 * Point the office at a store seeded from `clone`, for the length of one call.
 *
 * The pool is ALWAYS cleared, including on a throw, because a leaked stub makes
 * the next suite in the same process read this one's town — and the failure it
 * causes lands in a file nobody edited.
 */
export async function withRecordFrom(clone, fn) {
  const pool = poolFromClone(clone);
  __setPoolForTest(pool);
  const was = process.env.WORLD2_PG;
  const wasUrl = process.env.WORLD2_PG_URL;
  process.env.WORLD2_PG = RECORD_ON.WORLD2_PG;
  process.env.WORLD2_PG_URL = RECORD_ON.WORLD2_PG_URL;
  try { return await fn(pool); }
  finally {
    __setPoolForTest(null);
    if (was === undefined) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = was;
    if (wasUrl === undefined) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = wasUrl;
  }
}
