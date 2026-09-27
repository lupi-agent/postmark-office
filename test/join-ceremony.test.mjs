// join-ceremony.test.mjs — the mint, its refusals, and the writers it closed (POS-158).
//
// RULED (Keemin, 2026-09-22): the household's key is the declared slug, minted
// once at the human's co-sign, on every path into town; and, on this lane's
// STOP report, the house and the membership are TWO ROWS at TWO MOMENTS — the
// house at the co-sign, the membership at admission.
//
// THE POOL IS STUBBED, NOT MOCKED AROUND, exactly as `registry-drain.test.mjs`
// does it: `world2-acts.mjs` exports `__setPoolForTest`, and the stub answers
// the REAL queries `loadRegistryRows`, `upsertHousehold` and `upsertPin` send.
// So the path under test is the real store module, the real fold, the real
// renderer and the real drain decision — not a rehearsal of them. The stub
// holds its rows in memory and applies the upserts, which is what makes "mints
// exactly one row" a measurement rather than a count of calls.
//
// THE PEN IS INJECTED wherever one would be reached, for the reason
// `declareHousehold` has always injected its `commit`: the decision is what is
// being proven, and a real pen would want a clone, a bot identity and a remote
// to prove a branch that has nothing to do with any of them.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { __setPoolForTest } from "../src/world2-acts.mjs";
import { rowsFromRegistry, renderRegistry, registryFromRows, HOUSEHOLD_KEYS } from "../src/registry-rows.mjs";
import { REGISTRY_PATH, PINS_PATH, HANDLE_RE } from "../src/residency.mjs";
import {
  mintHousehold, joinHousehold, REFUSALS, SLUG_RE, SLUG_MIN, SLUG_MAX,
  slugIsWellFormed, collectingDrain, NO_DRAIN,
} from "../src/ceremony.mjs";
import { drainRegistry, checkRegistry, ingestMissing, missingFromStore } from "../tools/registry-drain.mjs";
import { conformance } from "../src/declare.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "fixtures", "registry-2026-09-22");
const HOUSEHOLDS_RAW = readFileSync(join(FIX, "households.json"), "utf8");
const PINS_RAW = readFileSync(join(FIX, "github-ids.json"), "utf8");

const ENV_ON = { WORLD2_PG: "1", WORLD2_PG_URL: "postgres://stub/none" };
const ENV_OFF = {};

/**
 * A pool that holds the registry in memory and APPLIES the writes.
 *
 * It answers the three reads and the two upserts with the same SQL shapes the
 * store really sends, so a test that says "one row was minted" is reading the
 * table the mint wrote rather than counting the calls it made.
 */
function stubPool(seed = rowsFromRegistry(JSON.parse(HOUSEHOLDS_RAW), JSON.parse(PINS_RAW))) {
  const state = {
    households: seed.households.map((r) => ({ ...r })),
    pins: seed.pins.map((r) => ({ ...r })),
    meta: { ...seed.meta },
    writes: { households: 0, pins: 0 },
  };
  const pool = {
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
          accounts: JSON.parse(params[4]), residents: params[5], since: params[6],
          member_of: params[7], declared_by: params[8], formerly: params[9],
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
      if (/FROM households/.test(text))
        return { rows: [...state.households].sort((a, b) => a.ord - b.ord).map((r) => ({ ...r, ord: Number(r.ord) })) };
      if (/FROM household_pins/.test(text))
        return { rows: [...state.pins].sort((a, b) => (a.handle < b.handle ? -1 : 1)).map((r) => ({ ...r, gh_id: String(r.gh_id) })) };
      if (/FROM registry_meta/.test(text))
        return { rows: Object.entries(state.meta).map(([key, value]) => ({ key, value })) };
      throw new Error(`the stub pool was asked something the ceremony should not ask: ${text}`);
    },
  };
  return pool;
}

function cloneWith(households = HOUSEHOLDS_RAW, pins = PINS_RAW) {
  const dir = mkdtempSync(join(tmpdir(), "pos158-"));
  mkdirSync(join(dir, "tools"), { recursive: true });
  if (households !== null) writeFileSync(join(dir, REGISTRY_PATH), households);
  if (pins !== null) writeFileSync(join(dir, PINS_PATH), pins);
  return dir;
}

const CO_SIGN = { ghId: 999000111, ghLogin: "a-new-human" };
const withPool = async (fn, pool = stubPool()) => {
  __setPoolForTest(pool);
  try { return await fn(pool); } finally { __setPoolForTest(null); }
};

// ── THE ALPHABET, AND WHO IT BINDS ──────────────────────────────────────────

test("the household alphabet IS the handle's, and the two cannot drift apart", () => {
  // `src/ceremony.mjs` restates the rule rather than importing it, so it reads
  // as its own law. That is only safe while this assertion stands.
  assert.equal(SLUG_RE.source, HANDLE_RE.source);
  assert.equal(SLUG_MIN, 2);
  assert.equal(SLUG_MAX, 40);
});

test("THREE live slugs fail the ruled check, not two — and none of them is ever re-validated", () => {
  // The ruling grandfathers "the two path-hostile slugs". Measured over the
  // 118 live rows there are three failures, and the third is a different KIND
  // of failure. This is a finding, not a defect: grandfathering is by
  // construction (the mint runs only on a slug somebody is choosing now), so
  // no allow-list is needed for any of them. It is asserted so that the count
  // in the PR is a measurement rather than a memory.
  const slugs = Object.keys(JSON.parse(HOUSEHOLDS_RAW).households);
  const failing = slugs.filter((s) => !slugIsWellFormed(s));
  assert.deepEqual(failing.sort(), [
    "cadaeic.space",
    "the-ashcroft-orleans-household-elijah-and-mackenzie",
    "victor-b.-rose-e.",
  ]);
  // two on the dot (path-hostile), one on length — a different rule
  assert.ok(failing.filter((s) => s.includes(".")).length === 2);
  assert.ok(failing.filter((s) => s.length > SLUG_MAX).length === 1);
});

// ── THE HOUSE ───────────────────────────────────────────────────────────────

test("the mint writes ONE house row and drains ONCE", async () => {
  await withPool(async (pool) => {
    const drains = [];
    const r = await mintHousehold({
      slug: "the-new-house", name: "The New House", coSign: CO_SIGN,
      residents: [], since: "2026-09-22", declaredBy: "a falsifier",
      env: ENV_ON, drain: async (o) => { drains.push(o); return { ran: true, changed: [] }; },
    });
    assert.equal(r.slug, "the-new-house");
    assert.equal(pool.state.writes.households, 1, "one row, never two");
    assert.equal(pool.state.writes.pins, 0, "the HOUSE is not the membership");
    assert.equal(drains.length, 1, "and the files follow in the same breath, once");
    assert.equal(pool.state.households.length, 119);
    const row = pool.state.households.find((h) => h.slug === "the-new-house");
    assert.equal(row.ord, 118, "a new house takes the next place at the end of the file");
    assert.deepEqual(row.accounts, [{ login: "a-new-human", id: 999000111 }]);
    assert.deepEqual(row.formerly, [], "no door writes `formerly`");
  });
});

test("a second declaration of a taken slug is REFUSED, with the ceremony's own sentence", async () => {
  await withPool(async (pool) => {
    await assert.rejects(
      () => mintHousehold({ slug: "fox-hearth", name: "Someone Else", coSign: CO_SIGN,
        since: "2026-09-22", declaredBy: "x", env: ENV_ON, drain: NO_DRAIN }),
      (e) => e.refusal === REFUSALS.TAKEN && e.code === 409);
    assert.equal(pool.state.writes.households, 0, "and nothing was written");
  });
});

test("`victor-b.-rose-e.` is REFUSED as a NEW slug and renders UNCHANGED as an existing row", async () => {
  // Both halves of the grandfathering, in one place, because either alone is a
  // half-truth: refusing it everywhere would rewrite a live house's key, and
  // allowing it anywhere would mint another path-hostile one tomorrow.
  assert.equal(slugIsWellFormed("victor-b.-rose-e."), false);
  await withPool(async (pool) => {
    await assert.rejects(
      () => mintHousehold({ slug: "victor-b.-rose-e.", coSign: CO_SIGN, since: "2026-09-22",
        declaredBy: "x", env: ENV_ON, drain: NO_DRAIN }),
      (e) => e.refusal === REFUSALS.BAD_SLUG || e.refusal === REFUSALS.TAKEN);
    assert.equal(pool.state.writes.households, 0);
  });
  // and the standing row is untouched by any of it
  assert.ok(HOUSEHOLDS_RAW.includes('"victor-b.-rose-e.": {'));
  const rows = rowsFromRegistry(JSON.parse(HOUSEHOLDS_RAW), JSON.parse(PINS_RAW));
  assert.equal(renderRegistry(rows).households, HOUSEHOLDS_RAW);
});

test("a slug the alphabet refuses is refused BEFORE the record is read", async () => {
  // THE PROBE MUST BE ABLE TO FAIL: with no pool set at all, a mint that read
  // the record first would throw something else. The refusal has to be the
  // alphabet's.
  await assert.rejects(
    () => mintHousehold({ slug: "Not A Slug", coSign: CO_SIGN, since: "2026-09-22",
      declaredBy: "x", env: ENV_ON, drain: NO_DRAIN }),
    (e) => e.refusal === REFUSALS.BAD_SLUG);
});

test("an unreachable record REFUSES the mint rather than founding over an empty roll", async () => {
  // NULL IS NOT EMPTY. Against an empty registry every slug is free, so a mint
  // that defaulted would write a duplicate over a live house and hand out a
  // second key for it.
  await assert.rejects(
    () => mintHousehold({ slug: "the-new-house", coSign: CO_SIGN, since: "2026-09-22",
      declaredBy: "x", env: ENV_OFF, drain: NO_DRAIN }),
    (e) => e.refusal === REFUSALS.NO_RECORD && e.code === 503);
});

// ── THE MEMBERSHIP ──────────────────────────────────────────────────────────

test("the membership writes the pin AND the residency, and drains once", async () => {
  await withPool(async (pool) => {
    await mintHousehold({ slug: "the-new-house", name: "The New House", coSign: CO_SIGN,
      residents: [], since: "2026-09-22", declaredBy: "x", env: ENV_ON, drain: NO_DRAIN });
    const drains = [];
    const r = await joinHousehold({
      slug: "the-new-house", handle: "new-arrival", coSign: CO_SIGN, pinnedOn: "2026-09-22",
      env: ENV_ON, drain: async () => { drains.push(1); return { ran: true, changed: [] }; },
    });
    assert.deepEqual(r.residents, ["new-arrival"]);
    assert.equal(r.pinned, true);
    assert.equal(drains.length, 1, "one drain for the whole membership");
    assert.equal(pool.state.writes.pins, 1);
    assert.equal(pool.state.pins.find((p) => p.handle === "new-arrival").gh_id, 999000111);
  });
});

test("a GAPPED ord sequence does not move a house, and a new one does not collide", async () => {
  // THE PROBE THE FIRST DRAFT COULD NOT FAIL. `joinHousehold` took the house's
  // POSITION in the folded object as its `ord`, and `mintHousehold` took the
  // COUNT as the next one. Both are right while the sequence runs 0..N-1 and
  // wrong the moment it has a gap — and `--ingest-missing` can leave one,
  // because it adopts a row at the position the FILE gives it.
  //
  // `households_ord_key` is UNIQUE, so the count-derived mint would have thrown
  // on a collision; the position-derived membership would have done something
  // worse and moved somebody's house without a word.
  const seed = rowsFromRegistry(JSON.parse(HOUSEHOLDS_RAW), JSON.parse(PINS_RAW));
  const gapped = {
    ...seed,
    households: seed.households.map((r, i) => ({ ...r, ord: i < 2 ? r.ord : Number(r.ord) + 50 })),
  };
  await withPool(async (pool) => {
    const victim = gapped.households[5];
    await joinHousehold({ slug: victim.slug, handle: "a-gap-joiner", coSign: CO_SIGN,
      env: ENV_ON, drain: NO_DRAIN });
    assert.equal(pool.state.households.find((h) => h.slug === victim.slug).ord, victim.ord,
      "the house kept its own place, not its index");

    await mintHousehold({ slug: "past-the-gap", coSign: CO_SIGN, since: "2026-09-22",
      declaredBy: "x", env: ENV_ON, drain: NO_DRAIN });
    const minted = pool.state.households.find((h) => h.slug === "past-the-gap");
    const highest = Math.max(...gapped.households.map((r) => Number(r.ord)));
    assert.equal(minted.ord, highest + 1, "and the new house lands past the HIGHEST, not past the count");
    assert.equal(pool.state.households.filter((h) => h.ord === minted.ord).length, 1,
      "one row at that place — the unique index would have refused two");
  }, stubPool(gapped));
});

test("the membership does NOT move the house's place in the file", async () => {
  // `ord` is the file's standing declaration order. Deriving a fresh one from
  // the current count would move an existing house to the end and rewrite
  // every row after it — 118 lines of diff for one resident joining.
  await withPool(async (pool) => {
    const before = pool.state.households.find((h) => h.slug === "fox-hearth").ord;
    await joinHousehold({ slug: "fox-hearth", handle: "a-new-sibling", coSign: CO_SIGN,
      env: ENV_ON, drain: NO_DRAIN });
    assert.equal(pool.state.households.find((h) => h.slug === "fox-hearth").ord, before);
  });
});

test("the membership NEVER re-binds a pin that already stands", async () => {
  // A handle the pin file already names has an identity on record, and
  // re-binding one is a human ceremony. A stranger's co-sign must not silently
  // repoint a live resident's id.
  await withPool(async (pool) => {
    const handle = Object.keys(JSON.parse(PINS_RAW))[0];
    const was = { ...pool.state.pins.find((p) => p.handle === handle) };
    const slug = pool.state.households.find((h) => (h.residents ?? []).length)?.slug;
    const r = await joinHousehold({ slug, handle, coSign: CO_SIGN, env: ENV_ON, drain: NO_DRAIN });
    assert.equal(r.pinned, false);
    assert.deepEqual(pool.state.pins.find((p) => p.handle === handle), was);
  });
});

test("joining a house that does not stand is refused by name", async () => {
  await withPool(async () => {
    await assert.rejects(
      () => joinHousehold({ slug: "no-such-house", handle: "somebody", coSign: CO_SIGN,
        env: ENV_ON, drain: NO_DRAIN }),
      (e) => e.refusal === REFUSALS.NO_SUCH_HOUSE);
  });
});

// ── ONE SENTENCE PER REFUSAL, AT EVERY PATH ─────────────────────────────────

test("a house-less request is refused with THE SAME OBJECT at every path", async () => {
  // POS-188 copies these strings verbatim, so the test is identity and not
  // equality: two paths that happen to spell the same sentence are two laws
  // one edit apart.
  const { conformance: conf } = await import("../src/declare.mjs");
  let fromDeclare = null;
  try {
    conf({ handle: "somebody", card: "hello", household: "  " },
      { db: { prepare: () => ({ get: () => null }) }, registry: { households: {} }, clone: null,
        key: { ghId: 1, ghLogin: "x", handles: new Set() } });
  } catch (e) { fromDeclare = e; }
  assert.equal(fromDeclare?.refusal, REFUSALS.NO_HOUSE, "the declaration door");

  const { default: _ } = { default: null };
  const apex = await import("../src/household-apex.mjs");
  assert.ok(apex, "the berth door's module loads");

  // the mint itself, reached with no slug at all
  let fromMint = null;
  try {
    await mintHousehold({ slug: "", coSign: CO_SIGN, since: "x", declaredBy: "x", drain: NO_DRAIN });
  } catch (e) { fromMint = e; }
  assert.equal(fromMint?.refusal, REFUSALS.NO_HOUSE, "the ceremony");

  assert.equal(conformance, conf, "and it is the same conformance the door exports");
});

test("every refusal is frozen, so no caller can edit the town's sentence in place", () => {
  for (const [name, r] of Object.entries(REFUSALS)) {
    assert.ok(Object.isFrozen(r), `${name} is frozen`);
    assert.equal(typeof r.defect, "string");
    assert.equal(typeof r.hint, "string");
    assert.ok(r.defect.length > 0 && r.hint.length > 0);
  }
});

// ── `formerly` ──────────────────────────────────────────────────────────────

test("`formerly` sits in the template and an EMPTY one renders byte-equal to today's file", () => {
  assert.ok(HOUSEHOLD_KEYS.includes("formerly"));
  // AFTER `declared_by`, and the assertion is now RELATIVE rather than "last":
  // POS-159's `provisional` appends after it (migration 021), and the law this
  // test guards is that no STANDING key ever moves — a new column joins the
  // tail, it does not push one. "Last" was the right words for a template with
  // one optional tail column and the wrong words for a template with two.
  assert.equal(HOUSEHOLD_KEYS.indexOf("formerly"), HOUSEHOLD_KEYS.indexOf("declared_by") + 1,
    "formerly sits immediately after declared_by");
  assert.deepEqual(HOUSEHOLD_KEYS.slice(-2), ["formerly", "provisional"],
    "the tail is the two optional columns, in the order their migrations landed");
  const rows = rowsFromRegistry(JSON.parse(HOUSEHOLDS_RAW), JSON.parse(PINS_RAW));
  assert.ok(rows.households.every((r) => Array.isArray(r.formerly) && r.formerly.length === 0));
  assert.equal(renderRegistry(rows).households, HOUSEHOLDS_RAW, "118 rows, not one `formerly` key");
});

test("a NON-empty `formerly` DOES render — the probe can fail", () => {
  const rows = rowsFromRegistry(JSON.parse(HOUSEHOLDS_RAW), JSON.parse(PINS_RAW));
  rows.households[0].formerly = ["an-older-key"];
  const out = registryFromRows(rows);
  assert.deepEqual(out.households[rows.households[0].slug].formerly, ["an-older-key"]);
  assert.notEqual(renderRegistry(rows).households, HOUSEHOLDS_RAW);
  // and it renders LAST within its house, where the template puts it
  const keys = Object.keys(out.households[rows.households[0].slug]);
  assert.equal(keys[keys.length - 1], "formerly");
});

test("an empty `residents` still renders — the empty-list rule binds ONE column", () => {
  // Widening it would silence a house with no residents, which IS a diff
  // somebody needs to see.
  const rows = rowsFromRegistry(JSON.parse(HOUSEHOLDS_RAW), JSON.parse(PINS_RAW));
  rows.households[0].residents = [];
  const out = registryFromRows(rows);
  assert.deepEqual(out.households[rows.households[0].slug].residents, []);
});

// ── THE DRAIN NEVER SHRINKS ─────────────────────────────────────────────────

test("a house the FILE holds and the table does not REFUSES the drain, by name", async () => {
  await withPool(async (pool) => {
    const doc = JSON.parse(HOUSEHOLDS_RAW);
    doc.households["a-merged-house"] = {
      name: "A Merged House", accounts: [{ login: "someone", id: 5551212 }],
      residents: ["a-merged-resident"], since: "2026-09-22", declared_by: "a hand PR the witness allowed",
    };
    const clone = cloneWith(JSON.stringify(doc, null, 2) + "\n", PINS_RAW);

    const calls = [];
    const r = await drainRegistry({ clone, env: ENV_ON, commit: (...a) => { calls.push(a); return "x"; } });
    assert.equal(r.ran, false, "nothing ran");
    assert.equal(calls.length, 0, "the pen was not even asked");
    assert.match(r.refused, /a-merged-house/, "and the refusal NAMES the row that would have vanished");
    assert.match(r.refused, /--ingest-missing/, "and says what to do about it");
    assert.deepEqual(r.missing.households, ["a-merged-house"]);
    // THE FILE IS UNTOUCHED — this is the whole point
    assert.equal(readFileSync(join(clone, REGISTRY_PATH), "utf8"), JSON.stringify(doc, null, 2) + "\n");
    assert.equal(pool.state.households.length, 118, "and nothing was adopted behind anyone's back");
  });
});

test("--check reports the shrink as a shrink, not as a differing line", async () => {
  await withPool(async () => {
    const doc = JSON.parse(HOUSEHOLDS_RAW);
    doc.households["a-merged-house"] = {
      accounts: [{ login: "someone", id: 5551212 }], residents: [], since: "2026-09-22", declared_by: "x",
    };
    const clone = cloneWith(JSON.stringify(doc, null, 2) + "\n", PINS_RAW);
    const r = await checkRegistry({ clone, env: ENV_ON });
    assert.equal(r.ok, false);
    assert.equal(r.shrinks, true);
    assert.deepEqual(r.missing.households, ["a-merged-house"]);
  });
});

test("a pin the FILE holds and the table does not refuses it too", async () => {
  await withPool(async () => {
    const pins = JSON.parse(PINS_RAW);
    pins["zz-a-hand-pinned-resident"] = { login: "someone", id: 5551212, pinned: "2026-09-22" };
    const clone = cloneWith(HOUSEHOLDS_RAW, JSON.stringify(pins, null, 2) + "\n");
    const r = await drainRegistry({ clone, env: ENV_ON, commit: () => "x" });
    assert.equal(r.ran, false);
    assert.deepEqual(r.missing.pins, ["zz-a-hand-pinned-resident"]);
  });
});

test("--ingest-missing adopts the row, and THEN the drain renders byte-equal", async () => {
  await withPool(async (pool) => {
    const doc = JSON.parse(HOUSEHOLDS_RAW);
    doc.households["a-merged-house"] = {
      name: "A Merged House", accounts: [{ login: "someone", id: 5551212 }],
      residents: ["a-merged-resident"], since: "2026-09-22", declared_by: "a hand PR the witness allowed",
    };
    const raw = JSON.stringify(doc, null, 2) + "\n";
    const clone = cloneWith(raw, PINS_RAW);

    const r = await ingestMissing({ clone, env: ENV_ON, reason: "merged by the Registrar before the flip" });
    assert.equal(r.ran, true);
    assert.deepEqual(r.adopted.households.map((h) => h.slug), ["a-merged-house"]);
    assert.equal(r.adopted.households[0].ord, 118, "at the place the FILE gives it");
    assert.equal(pool.state.households.length, 119);

    const calls = [];
    const d = await drainRegistry({ clone, env: ENV_ON, commit: (...a) => { calls.push(a); return "sha"; } });
    assert.equal(d.ran, true, "and now it runs");
    assert.deepEqual(d.changed, [], "byte-equal: the store renders exactly what the file already held");
    assert.equal(calls.length, 0);
    assert.equal(readFileSync(join(clone, REGISTRY_PATH), "utf8"), raw);

    const c = await checkRegistry({ clone, env: ENV_ON });
    assert.equal(c.ok, true, "and the gate agrees");
  });
});

test("--ingest-missing refuses rather than guess when two rows claim one place", async () => {
  await withPool(async (pool) => {
    // A file whose new house sits at a position the table already holds. This
    // cannot arise from an append, which is where every real one comes from —
    // so the branch exists to REFUSE rather than to be taken.
    const doc = JSON.parse(HOUSEHOLDS_RAW);
    const reordered = { "a-house-at-the-front": {
      accounts: [{ login: "someone", id: 5551212 }], residents: [], since: "2026-09-22", declared_by: "x",
    }, ...doc.households };
    const clone = cloneWith(JSON.stringify({ ...doc, households: reordered }, null, 2) + "\n", PINS_RAW);
    await assert.rejects(
      () => ingestMissing({ clone, env: ENV_ON, reason: "x" }),
      (e) => /two rows cannot claim one place/.test(e.message));
    assert.equal(pool.state.households.length, 118, "nothing was adopted");
  });
});

test("missingFromStore is pure and answers by KEY, never by content", () => {
  const rows = rowsFromRegistry(JSON.parse(HOUSEHOLDS_RAW), JSON.parse(PINS_RAW));
  const doc = JSON.parse(HOUSEHOLDS_RAW);
  // a row whose CONTENT differs is an ordinary diff, which `--check` names by
  // line; it is NOT a row that would vanish, so it is not this function's
  doc.households["fox-hearth"].name = "Fox Hearths";
  assert.deepEqual(missingFromStore(rows, doc, JSON.parse(PINS_RAW)), { households: [], pins: [] });
});

// ── ONE COMMIT ──────────────────────────────────────────────────────────────

test("collectingDrain writes the files and hands back the paths, committing nothing", async () => {
  await withPool(async () => {
    const clone = cloneWith("{}\n", "{}\n");
    const { drain, paths } = collectingDrain({ clone });
    const r = await drain({ env: ENV_ON });
    assert.equal(r.ran, true);
    assert.equal(r.commit, null, "the caller holds the pen, not the drain");
    assert.equal(paths.length, 2, "and it hands back both paths to be staged beside the caller's own");
    assert.equal(readFileSync(join(clone, REGISTRY_PATH), "utf8"), HOUSEHOLDS_RAW);
    assert.equal(readFileSync(join(clone, PINS_PATH), "utf8"), PINS_RAW);
  });
});

test("a two-row ceremony renders ONCE, not once per row", async () => {
  // The house's mint defers and the membership's drain renders both. A drain
  // between them would publish a house whose first resident has no pin.
  await withPool(async (pool) => {
    const clone = cloneWith();
    const { drain, paths } = collectingDrain({ clone });
    await mintHousehold({ slug: "two-row-house", name: "Two Row House", coSign: CO_SIGN,
      residents: ["two-row-resident"], since: "2026-09-22", declaredBy: "x", env: ENV_ON, drain: NO_DRAIN });
    // between the two rows the record holds a house with an unpinned resident
    assert.equal(pool.state.pins.some((p) => p.handle === "two-row-resident"), false);
    assert.equal(readFileSync(join(clone, REGISTRY_PATH), "utf8"), HOUSEHOLDS_RAW,
      "and the town's file has NOT been shown that half-state");

    await joinHousehold({ slug: "two-row-house", handle: "two-row-resident", coSign: CO_SIGN,
      pinnedOn: "2026-09-22", env: ENV_ON, drain });
    assert.equal(paths.length, 2, "one render, over both files, after both rows");
    const after = JSON.parse(readFileSync(join(clone, REGISTRY_PATH), "utf8"));
    assert.deepEqual(after.households["two-row-house"].residents, ["two-row-resident"]);
    assert.ok(JSON.parse(readFileSync(join(clone, PINS_PATH), "utf8"))["two-row-resident"]);
  });
});

// ── A MEMBERSHIP WRITE NEVER BLOCKS THE TOWN ────────────────────────────────

test("a store that throws AT WRITE TIME defers the row — the crossing completes", async () => {
  // RULED (Keemin, 2026-09-22, review 2/6): a membership write must never block
  // the town. `writeTownDrain` wrapped its mints in no try/catch, so a store
  // failure between the plan and the write threw out of the drain, out of the
  // tool, and out of an `&&`-joined ferry chain — a household row failing to
  // land stopped the TOWN'S MAIL.
  //
  // The falsifier drives the real `writeTownDrain` against a pool that reads
  // fine and refuses every write, which is the shape a lost connection or a
  // revoked grant actually has: the plan was computed, and the write is what
  // fails.
  const { writeTownDrain, STORE_WRITE_FAILED } = await import("../src/town-drain.mjs");
  const { planRegistryJoin } = await import("../src/residency.mjs");

  const seeded = stubPool();
  const readsButCannotWrite = {
    async query(text, params) {
      if (/^\s*INSERT INTO/.test(text)) throw new Error("permission denied for table households");
      return seeded.query(text, params);
    },
  };

  const clone = cloneWith();
  const registry = JSON.parse(HOUSEHOLDS_RAW);
  const row = {
    seq: 7, cls: "join", act: "declare-household", handle: "a-stalled-arrival",
    ghId: 4242, ghLogin: "stalled-human",
    payload: { household: "A Stalled House", card: "hello" },
  };
  const p = planRegistryJoin(registry, {
    handle: row.handle, household: row.payload.household,
    ghId: row.ghId, ghLogin: row.ghLogin, date: "2026-09-22",
  });

  __setPoolForTest(readsButCannotWrite);
  const was = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
  Object.assign(process.env, ENV_ON);
  let touched;
  try {
    // IT MUST NOT THROW. That is the whole ruling, and it is asserted by the
    // absence of a rejection around this call rather than by a comment.
    touched = await writeTownDrain(clone, { plans: [{ row, plan: p }], registry }, { date: "2026-09-22" });
  } finally {
    __setPoolForTest(null);
    if (was.pg === undefined) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = was.pg;
    if (was.url === undefined) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = was.url;
  }

  assert.ok(Array.isArray(touched), "the crossing completed and answered");
  assert.equal(touched.stalled?.length, 1, "and the row is named as stalled");
  assert.equal(touched.stalled[0].row.seq, 7);
  assert.match(touched.stalled[0].why, /still pending/);
  assert.match(touched.stalled[0].why, /permission denied/, "the operator gets the store's own words");
  assert.equal(touched.stalled[0].why, STORE_WRITE_FAILED(new Error("permission denied for table households")),
    "the sentence is the module's, not this test's");

  // AND NOT ONE BYTE WAS WRITTEN FOR IT. The record comes first precisely so a
  // stalled row leaves no ADDRESS card standing for a resident the record
  // cannot account for.
  // LENGTH, not deep-equality: `touched` is the list of paths to stage, and it
  // also carries `stalled` (and `refused`) as properties for `runTownDrain` to
  // read — the same shape `refused` has ridden since this lane opened. What
  // "nothing to commit" means is that the list of PATHS is empty.
  assert.equal(touched.length, 0, "nothing to commit — the row simply did not settle");
  assert.equal(existsSync(join(clone, "WHITE_PAGES", "a-stalled-arrival", "ADDRESS.md")), false);
});

// ── SYBIL 1b: TWO MINTS CANNOT CLAIM ONE PLACE ──────────────────────────────

test("two mints landing together take DIFFERENT places — the database chooses", async () => {
  // THE HOLE (review 4/6). `ord` was computed in JavaScript from a read taken
  // before the write, with no transaction in between, so two mints landing
  // together both chose the same next place. `households_ord_key` is UNIQUE and
  // `upsertHousehold`'s ON CONFLICT names the SLUG only, so the loser did not
  // update anything — it threw, and `src/residency.mjs` swallowed the throw
  // into a `console.warn` while telling the resident their house was declared.
  //
  // The probe interleaves the two mints against one store, which is what
  // "landing together" means for a single-connection pool: both reads happen
  // before either write.
  await withPool(async (pool) => {
    const before = pool.state.households.length;
    const [a, b] = await Promise.all([
      mintHousehold({ slug: "race-one", coSign: CO_SIGN, since: "2026-09-22",
        declaredBy: "x", env: ENV_ON, drain: NO_DRAIN }),
      mintHousehold({ slug: "race-two", coSign: { ghId: 7, ghLogin: "other-human" },
        since: "2026-09-22", declaredBy: "x", env: ENV_ON, drain: NO_DRAIN }),
    ]);
    assert.notEqual(a.row.ord, b.row.ord, "two houses, two places");
    assert.equal(pool.state.households.length, before + 2, "and both landed");
    const ords = pool.state.households.map((h) => Number(h.ord));
    assert.equal(new Set(ords).size, ords.length, "no two rows share a place");
  });
});

test("a mint whose write fails REFUSES the join — never a warn with a false note", async () => {
  // The other half of 4/6. `requestResidency` refused only on a taken slug and
  // downgraded every other failure to a `console.warn`, while its answer went
  // on saying "the same PR declares your household … the Registrar's merge
  // completes both at once". It did not. A house that was not founded,
  // announced as founded, is the one receipt a town must never hand out.
  const { requestResidency } = await import("../src/residency.mjs");
  const { fixtureDb } = await import("./fixture.mjs");

  const seeded = stubPool();
  const readsButCannotWrite = {
    async query(text, params) {
      if (/^\s*INSERT INTO households/.test(text)) throw new Error("permission denied for table households");
      return seeded.query(text, params);
    },
  };
  __setPoolForTest(readsButCannotWrite);
  const was = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
  Object.assign(process.env, ENV_ON);
  try {
    await assert.rejects(
      () => requestResidency(
        { handle: "told-the-truth", card: "hello", household: "A House That Will Not Land" },
        { ghId: 4242, ghLogin: "truthful-human", handles: new Set() },
        fixtureDb(),
        { apiBase: "http://127.0.0.1:1", token: "t", owner: "o", repo: "r", baseBranch: "main" }),
      (e) => {
        assert.ok(e.code, "it is a bounce, with a code");
        assert.match(String(e.defect), /permission denied|record/i, "and it says what happened");
        return true;
      });
  } finally {
    __setPoolForTest(null);
    if (was.pg === undefined) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = was.pg;
    if (was.url === undefined) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = was.url;
  }
});

// ── A REFUSED DRAIN IS NEVER SILENT ─────────────────────────────────────────

test("a mint whose DRAIN refuses still founds the house, and says the files did not follow", async () => {
  // Review 6/6. `drainRegistry` answers `{ ran: false, refused }` rather than
  // shrink the registry, and both ceremonies dropped that answer on the floor:
  // the row had landed and the town's two files had NOT been re-rendered — a
  // state only a person can clear with `registry-drain --ingest-missing` — and
  // the door answered as if everything had landed.
  //
  // IT IS NOT A REFUSAL OF THE CEREMONY. The house IS founded and the record IS
  // the record; the files are a rendering one crossing behind. Telling a
  // resident their house failed would be as untrue as saying nothing.
  await withPool(async (pool) => {
    const r = await mintHousehold({
      slug: "a-house-whose-files-lag", coSign: CO_SIGN, since: "2026-09-22",
      declaredBy: "x", env: ENV_ON,
      drain: async () => ({ ran: false, refused: "the files hold `a-merged-house`, which the store does not", changed: [] }),
    });
    assert.ok(pool.state.households.some((h) => h.slug === "a-house-whose-files-lag"),
      "the house IS founded — the record is the record");
    assert.deepEqual(r.registry, {
      rendered: false,
      refused: "the files hold `a-merged-house`, which the store does not",
    }, "and the outcome rides back in the ceremony's own shape");
  });
});

test("a mint whose drain succeeds says so plainly", async () => {
  // The other side, so `rendered` is a fact and not a field that only ever
  // appears when something went wrong.
  await withPool(async () => {
    const r = await mintHousehold({
      slug: "a-house-whose-files-follow", coSign: CO_SIGN, since: "2026-09-22",
      declaredBy: "x", env: ENV_ON,
      drain: async () => ({ ran: true, changed: [REGISTRY_PATH, PINS_PATH], commit: null }),
    });
    assert.deepEqual(r.registry, { rendered: true });
  });
});

test("the membership carries the same outcome, in the same shape", async () => {
  await withPool(async () => {
    const r = await joinHousehold({
      slug: "fox-hearth", handle: "a-lagging-join", coSign: CO_SIGN, env: ENV_ON,
      drain: async () => ({ ran: false, refused: "a pin the files hold and the store does not", changed: [] }),
    });
    assert.equal(r.registry.rendered, false);
    assert.match(r.registry.refused, /a pin the files hold/);
  });
});
