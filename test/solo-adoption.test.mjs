// solo-adoption.test.mjs — POS-212: `solo:` parcels are adopted by the house —
// at the ceremony, and once by batch for the houses that stand; the cap counts
// them only after the batch.
//
// ── THE STORE IS IN MEMORY, AND WHAT THAT DOES NOT PROVE ────────────────────
//
// No Postgres is available to this suite. `worldStore` is the registry stub
// (`test/registry-pool-stub.mjs`, which now also answers the ceremony's one
// adoption statement) plus the statements the batch, `materializeClaims` and
// `recomputeStanding` make — and an unknown statement THROWS, because answering
// [] would be a lie. It keeps the store's rules this path leans on: `claims.id`
// is a primary key and `claims.supersedes` a foreign key; `BEGIN READ ONLY`
// refuses every write; ROLLBACK restores. It is not Postgres: the ceremony's
// CTE is answered by the stub's reading of it, not by a planner. The real round
// trip is the dev sandbox run (`--dry-run`, the run, a second run), which is the
// operator's, before prod.

import test from "node:test";
import assert from "node:assert/strict";

import { __setPoolForTest } from "../src/world2-acts.mjs";
import { rowsFromRegistry, registryFromRows, pinsFromRows } from "../src/registry-rows.mjs";
import { houseKeysOf, __clearHouseCache } from "../src/household-deriver.mjs";
import { joinHousehold, NO_DRAIN } from "../src/ceremony.mjs";
import { makePool, RECORD_ON } from "./registry-pool-stub.mjs";
import {
  planAdoption, soloHouseIndex, soloCountedAt, ADOPT_ACTION, ADOPT_CLASS, COUNTED_ACTION,
} from "../src/solo-adoption.mjs";
import { adoptSolo, adoptionClaimId } from "../world2/tools/adopt-solo.mjs";
import { materializeClaims } from "../world2/tools/materialize.mjs";
import {
  heldParcelsByCred, parcelCapRefusals, countingSolo, credOf, PARCEL_CAP_CHECK,
} from "../world2/tools/parcel-cap.mjs";
import { resolveHouse } from "../src/household-deriver.mjs";

// ── the fixture town ─────────────────────────────────────────────────────────
//
// Cap 3. Three standing houses the batch adopts into — UNDER (2 after), AT (3
// after, exactly the cap), OVER (5 after) — and a fourth house a resident JOINS
// holding two `solo:` parcels of their own. One `solo:` row no house holds.

const LAW = Object.freeze({
  cap: 3, lawDate: "2026-07-30", exceptions: new Set(), sha: "f1x7ure0",
  compare: (a, b) => (String(a.date ?? "") < String(b.date ?? "") ? -1 : String(a.date ?? "") > String(b.date ?? "") ? 1
    : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
});

const house = (residents, login, id) => ({
  name: null, human: null, accounts: [{ login, id }], residents, since: "2026-07-01",
  member_of: null, declared_by: residents[0] ?? login, formerly: [], provisional: false,
});
const REGISTRY = {
  schema_version: 1,
  households: {
    under: house(["ursa"], "UrsaLogin", 101),
    "at-cap": house(["atlas"], "atlaslogin", 102),
    over: house(["otto"], "ottologin", 103),
    "joiners-house": house(["host"], "hostlogin", 104),
  },
};
const PINS = {
  ursa: { login: "UrsaLogin", id: 101 }, atlas: { login: "atlaslogin", id: 102 },
  otto: { login: "ottologin", id: 103 }, host: { login: "hostlogin", id: 104 },
};
const JO = { handle: "jo", coSign: { ghId: 105, ghLogin: "jologin" } };

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const mark = (owner, household, kind = "parcel") => {
  const id = uuid();
  const x = n * 100;
  return {
    id, slug: `${owner}/${kind}-${n}`, kind, owner, household, body: `the ${kind} ${owner} placed`,
    geometry: { slug: `${owner}/${kind}-${n}`, at: { x, y: 0 }, extent: { w: 10, h: 10 } },
    bbox: `(${x + 5},5),(${x - 5},-5)`, status: "standing", locked_window: 1, retired_window: null,
    parent: null, data: { date: "2026-07-15", tier: "market" },
  };
};

function fixtureMarks() {
  n = 0;
  return [
    // UNDER: 1 held + 1 adopted parcel (and one adopted non-parcel, by its LOGIN spelling) = 2
    mark("ursa", "hh:under"), mark("ursa", "solo:ursa"), mark("ursa", "solo:UrsaLogin", "sited"),
    // AT: 2 held (two spellings the deriver walks) + 1 adopted = 3, exactly the cap
    mark("atlas", "gh:102"), mark("atlas", "hh:at-cap"), mark("atlas", "solo:atlas"),
    // OVER: 3 held + 2 adopted = 5
    mark("otto", "hh:over"), mark("otto", "hh:over"), mark("otto", "hh:over"),
    mark("otto", "solo:otto"), mark("otto", "solo:ottologin"),
    // the joiner's own two, placed before they had a house
    mark("jo", "solo:jo"), mark("jo", "solo:jo"),
    // a spelling no house holds
    mark("nobody", "solo:nobody"),
  ];
}

// ── the store ────────────────────────────────────────────────────────────────

function worldStore({ registry = REGISTRY, pins = PINS, marks = fixtureMarks() } = {}) {
  const seed = rowsFromRegistry(registry, pins);
  seed.marks = marks;
  // Every standing mark stands on the claim that locked it (001: `marks.id` =
  // a locking claim's id), which is what `claims.supersedes` must name.
  seed.claims = marks.map((m) => ({ id: m.id, slug: m.slug, status: "locked", supersedes: null, data: {} }));
  seed.windows = [{ id: 1, status: "cleared" }, { id: 7, status: "open" }];
  const pool = makePool(seed);
  const S = pool.state;
  let snapshot = null, readOnly = false;
  const writes = [];
  const grab = () => structuredClone({ marks: S.marks, claims: S.claims, acts: S.acts, households: S.households, pins: S.pins });
  const restore = (s) => { for (const k of Object.keys(s)) S[k] = s[k]; };

  const query = async (text, params = []) => {
    const t = text.trim();
    if (/^(INSERT|UPDATE|DELETE|WITH)\b/i.test(t)) {
      if (readOnly) throw new Error(`cannot execute ${t.split(/\s+/)[0]} in a read-only transaction`);
      writes.push(t.split("\n")[0].slice(0, 60));
    }
    if (/^BEGIN READ ONLY$/i.test(t)) { snapshot = grab(); readOnly = true; return { rows: [] }; }
    if (/^BEGIN$/i.test(t)) { snapshot = grab(); readOnly = false; return { rows: [] }; }
    if (/^COMMIT$/i.test(t)) { snapshot = null; readOnly = false; return { rows: [] }; }
    if (/^ROLLBACK$/i.test(t)) { if (snapshot) restore(snapshot); snapshot = null; readOnly = false; return { rows: [] }; }

    if (/FROM acts WHERE class = 'household' AND action = 'solo-counted'/.test(t))
      return { rows: S.acts.filter((a) => a.class === ADOPT_CLASS && a.action === COUNTED_ACTION).slice(0, 1).map(() => ({ counted: 1 })) };
    if (/FROM windows WHERE status = 'open'/.test(t)) {
      const o = S.windows.filter((w) => w.status === "open").sort((a, b) => b.id - a.id)[0];
      return { rows: o ? [{ id: o.id }] : [] };
    }
    if (/has_table_privilege/.test(t)) {
      const k = (t.match(/has_table_privilege/g) ?? []).length;
      const r = { whoami: "world2_owner" };
      for (let i = 0; i < k; i++) r[`p${i}`] = true;
      return { rows: [r] };
    }
    if (/^INSERT INTO acts \(at, crossing/.test(t)) {
      const [at, crossing, actor, action, object, cls, payload, effect, household] = params;
      const id = String(S.acts.length + 1);
      S.acts.push({ id, at, crossing, actor, action, object, class: cls, payload: JSON.parse(payload), effect, household });
      return { rows: [{ id }] };
    }
    if (/^INSERT INTO claims \(id, window_id/.test(t)) {
      const [id, window_id, slug, cls, claimant, household, , status, , body, geometry, bbox, stake, data, parent, supersedes] = params;
      if (S.claims.some((c) => String(c.id) === String(id))) throw new Error(`duplicate key value violates unique constraint "claims_pkey" (${id})`);
      if (supersedes != null && !S.claims.some((c) => String(c.id) === String(supersedes))) throw new Error(`claims.supersedes ${supersedes} names no claim`);
      S.claims.push({ id, window_id, slug, class: cls, claimant, household, status, body,
        geometry: JSON.parse(geometry), bbox, stake, data: JSON.parse(data), parent, supersedes });
      return { rows: [], rowCount: 1 };
    }
    if (/FROM marks\s+WHERE id = ANY\(\$1::uuid\[\]\) AND status = 'standing' AND household LIKE 'solo:%'/.test(t))
      return { rows: S.marks.filter((m) => params[0].includes(String(m.id)) && m.status === "standing" && m.household.startsWith("solo:"))
        .sort((a, b) => (a.slug < b.slug ? -1 : 1)).map((m) => structuredClone(m)) };
    if (/^UPDATE marks SET kind = \$2/.test(t)) {
      const [id, kind, owner, household, body, geometry, bbox, data, parent, locked_window] = params;
      const m = S.marks.find((r) => String(r.id) === String(id));
      if (!m) return { rows: [], rowCount: 0 };
      const j = (v) => (typeof v === "string" ? JSON.parse(v) : structuredClone(v));
      Object.assign(m, { kind, owner, household, body, geometry: j(geometry), bbox, data: j(data), parent, locked_window });
      return { rows: [], rowCount: 1 };
    }
    if (/FROM marks WHERE status = 'standing'$/.test(t))
      return { rows: S.marks.filter((m) => m.status === "standing").map((m) => structuredClone(m)) };
    if (/FROM pg_indexes/.test(t)) return { rows: [] };
    if (/^UPDATE marks SET data = jsonb_set/.test(t)) {
      const m = S.marks.find((r) => String(r.id) === String(params[0]));
      if (m) m.data = { ...(m.data ?? {}), tier: params[1] };
      return { rows: [], rowCount: m ? 1 : 0 };
    }
    if (/SELECT household, COUNT\(\*\)::int AS n FROM marks WHERE kind = 'parcel' AND status = 'standing' GROUP BY household/.test(t)) {
      const by = new Map();
      for (const m of S.marks) if (m.kind === "parcel" && m.status === "standing") by.set(m.household, (by.get(m.household) ?? 0) + 1);
      return { rows: [...by].map(([household, k]) => ({ household, n: k })) };
    }
    return pool.query(text, params);
  };
  return { client: { query }, pool, state: S, writes, q: (text, args) => query(text, args) };
}

function withOffice(store, fn) {
  __setPoolForTest(store.pool);
  const was = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
  process.env.WORLD2_PG = RECORD_ON.WORLD2_PG;
  process.env.WORLD2_PG_URL = RECORD_ON.WORLD2_PG_URL;
  __clearHouseCache();
  return (async () => {
    try { return await fn(); }
    finally {
      __setPoolForTest(null);
      __clearHouseCache();
      if (was.pg === undefined) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = was.pg;
      if (was.url === undefined) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = was.url;
    }
  })();
}

const registryOf = (S) => {
  const rows = { households: S.households, pins: S.pins, meta: S.meta };
  return { registry: registryFromRows(rows), pins: pinsFromRows(rows) };
};
const bySlug = (S, slug) => S.marks.find((m) => m.slug === slug);

// ═══════════════════════════════════════════════════════════════════════════
// 1 · THE CEREMONY
// ═══════════════════════════════════════════════════════════════════════════

test("FALSIFIER 1 · a resident with two solo: parcels joins a house — both are the house's, the act is on the record, the set keeps solo:", async () => {
  const store = worldStore();
  const S = store.state;
  const jos = S.marks.filter((m) => m.household === "solo:jo");
  assert.equal(jos.length, 2, "the fixture resident holds two solo: parcels");

  // BEFORE: no house holds `solo:jo` — the spelling is an orphan.
  const before = registryOf(S);
  assert.equal(soloHouseIndex(before.registry, before.pins).get("solo:jo"), undefined);

  const r = await withOffice(store, () => joinHousehold({
    slug: "joiners-house", handle: JO.handle, coSign: JO.coSign, env: { ...process.env, ...RECORD_ON }, drain: NO_DRAIN,
  }));

  // THE CEREMONY FILED THE DOOR'S AMEND: one pending claim per mark, superseding it,
  // carrying every byte of the mark, under the house's key.
  assert.equal(r.adopted.filed, 2, JSON.stringify(r.adopted));
  const filed = S.claims.filter((c) => c.status === "pending" && c.data?._adopted);
  assert.deepEqual(filed.map((c) => String(c.supersedes)).sort(), jos.map((m) => m.id).sort());
  for (const c of filed) {
    const m = S.marks.find((x) => x.id === c.supersedes);
    assert.equal(c.household, "hh:joiners-house");
    assert.equal(c.claimant, m.owner);
    assert.deepEqual([c.class, c.body, c.geometry, c.bbox, c.parent], [m.kind, m.body, m.geometry, m.bbox, m.parent],
      "an adoption changes nothing the resident authored");
    assert.deepEqual(c.data._adopted, { from: "solo:jo", to: "hh:joiners-house", at: "ceremony" });
  }

  // THE ACT IS ON THE RECORD, and the claims name it.
  const acts = S.acts.filter((a) => a.action === ADOPT_ACTION && a.class === ADOPT_CLASS);
  assert.equal(acts.length, 1);
  assert.equal(acts[0].household, "hh:joiners-house");
  assert.match(acts[0].effect, /the house joiners-house adopts 2 marks placed before it had a key — solo:jo becomes hh:joiners-house/);
  for (const c of filed) assert.equal(c.data._act_id, String(acts[0].id));

  // THE SPELLING SET STILL CONTAINS solo: — old references keep reading.
  const after = registryOf(S);
  assert.ok(houseKeysOf("hh:joiners-house", after.registry, after.pins).includes("solo:jo"));

  // THE CROSSING RULES IT: the clearing's own `materializeClaims`, handed the
  // pending claims as amends of the marks they supersede (clearing-job step 1),
  // re-grains each row by its OWNER — `solo:jo` becomes the house's key.
  const amends = new Map(filed.map((c) => [String(c.id), { id: String(c.supersedes) }]));
  await materializeClaims(store.q, { claims: filed, amends, windowId: 7, label: "the next crossing" });
  for (const m of jos) {
    const now = bySlug(S, m.slug);
    assert.equal(now.household, "hh:joiners-house", `${m.slug} reads as the house's after the crossing`);
    assert.equal(now.id, m.id, "the mark keeps its id (012: a mark's id is its identity)");
    assert.equal(now.body, m.body);
  }
});

test("FALSIFIER 1b · the ceremony asked twice files once, and adopts nobody else's marks", async () => {
  const store = worldStore();
  const S = store.state;
  const env = { ...process.env, ...RECORD_ON };
  await withOffice(store, async () => {
    const a = await joinHousehold({ slug: "joiners-house", handle: JO.handle, coSign: JO.coSign, env, drain: NO_DRAIN });
    const b = await joinHousehold({ slug: "joiners-house", handle: JO.handle, coSign: JO.coSign, env, drain: NO_DRAIN });
    assert.equal(a.adopted.filed, 2);
    assert.equal(b.adopted.filed, 0, "the second ask finds the first one's claims pending");
  });
  assert.equal(S.acts.filter((x) => x.action === ADOPT_ACTION).length, 1, "one act, not two");
  const touched = new Set(S.claims.filter((c) => c.data?._adopted).map((c) => bySlug(S, c.slug).household));
  assert.deepEqual([...touched], ["solo:jo"], "only the joiner's spelling was adopted — no standing house's rows");
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 · THE BATCH
// ═══════════════════════════════════════════════════════════════════════════

test("FALSIFIER 2 · the batch's --dry-run lists every solo: mark a house holds, with its target, and writes nothing", async () => {
  const store = worldStore();
  const r = await adoptSolo(store.client, { law: LAW, dryRun: true });
  assert.equal(r.status, "dry-run");
  assert.deepEqual(store.writes, [], "BEGIN READ ONLY — nothing was written");
  const byHouse = Object.fromEntries(r.plan.houses.map((h) => [h.key, h]));
  assert.deepEqual(Object.keys(byHouse).sort(), ["hh:at-cap", "hh:over", "hh:under"],
    "three standing houses; the joiner holds no house yet, so solo:jo is an orphan here");
  assert.deepEqual(byHouse["hh:under"].from, ["solo:UrsaLogin", "solo:ursa"], "a LOGIN spelling is adopted too (#166's measured class)");
  assert.deepEqual(byHouse["hh:under"].parcels, { held: 1, adopted: 1, total: 2 });
  assert.deepEqual(byHouse["hh:at-cap"].parcels, { held: 2, adopted: 1, total: 3 });
  assert.deepEqual(byHouse["hh:over"].parcels, { held: 3, adopted: 2, total: 5 });
  assert.deepEqual([byHouse["hh:under"].overCap, byHouse["hh:at-cap"].overCap, byHouse["hh:over"].overCap], [false, false, true]);
  assert.deepEqual(r.summary.over_cap, ["hh:over"]);
  assert.deepEqual(r.plan.orphans.map((o) => o.from).sort(), ["solo:jo", "solo:jo", "solo:nobody"]);
  assert.match(r.receipt, /OVER CAP 1: hh:over \(5\)/);
  assert.match(r.receipt, /hh:over {2}← solo:otto, solo:ottologin {2}· 2 mark\(s\), parcels 3 held \+ 2 adopted = 5 {2}OVER CAP \(grandfathered/);
  console.log(`\n${r.receipt}\n${JSON.stringify({ status: r.status, ...r.summary })}\n`);
});

test("FALSIFIER 3 · the batch adopts ALL three houses (the over-cap one too, listed), one receipt each; a second run changes nothing", async () => {
  const store = worldStore();
  const S = store.state;
  const soloBefore = S.marks.filter((m) => m.household.startsWith("solo:")).map((m) => ({ ...m }));

  const r = await adoptSolo(store.client, { law: LAW });
  assert.equal(r.status, "adopted", r.receipt);

  // Every held spelling is now the house's key; nothing else about the mark moved.
  const want = { "solo:ursa": "hh:under", "solo:UrsaLogin": "hh:under", "solo:atlas": "hh:at-cap",
    "solo:otto": "hh:over", "solo:ottologin": "hh:over" };
  for (const was of soloBefore) {
    const now = bySlug(S, was.slug);
    if (want[was.household]) {
      assert.equal(now.household, want[was.household], `${was.slug}`);
      assert.deepEqual([now.id, now.body, now.geometry, now.owner, now.kind], [was.id, was.body, was.geometry, was.owner, was.kind]);
      const c = S.claims.find((x) => x.id === adoptionClaimId(was.id, want[was.household]));
      assert.ok(c, `the version is in the log as its own claim row (${was.slug})`);
      assert.deepEqual([c.status, String(c.supersedes)], ["locked", was.id]);
    } else {
      assert.equal(now.household, was.household, `${was.slug} is not held by a house and stands as it was`);
    }
  }

  // One receipt per house; the over-cap house is adopted AND listed.
  const receipts = S.acts.filter((a) => a.action === ADOPT_ACTION);
  assert.deepEqual(receipts.map((a) => a.object).sort(), ["hh:at-cap", "hh:over", "hh:under"]);
  const over = receipts.find((a) => a.object === "hh:over");
  assert.equal(over.payload.over_cap, true);
  assert.match(over.payload.grandfathered, /adopted anyway/);
  assert.match(over.effect, /OVER CAP, grandfathered/);
  assert.equal(receipts.find((a) => a.object === "hh:at-cap").payload.over_cap, false, "exactly at the cap is not over it");
  assert.equal(S.acts.filter((a) => a.action === COUNTED_ACTION).length, 1, "the count's store fact, once");

  // IDEMPOTENT: a second run is a no-op and writes nothing.
  const frozen = structuredClone({ marks: S.marks, claims: S.claims, acts: S.acts });
  const w = store.writes.length;
  const again = await adoptSolo(store.client, { law: LAW });
  assert.equal(again.status, "noop", again.receipt);
  assert.equal(store.writes.length, w, "no statement wrote");
  assert.deepEqual(structuredClone({ marks: S.marks, claims: S.claims, acts: S.acts }), frozen);
});

test("FALSIFIER 3b · a mark the ceremony already filed is PENDING for the crossing, not adopted twice", async () => {
  const store = worldStore();
  const S = store.state;
  await withOffice(store, () => joinHousehold({ slug: "joiners-house", handle: JO.handle, coSign: JO.coSign,
    env: { ...process.env, ...RECORD_ON }, drain: NO_DRAIN }));
  const r = await adoptSolo(store.client, { law: LAW, dryRun: true });
  assert.equal(r.plan.pending.length, 2);
  assert.ok(!r.plan.houses.some((h) => h.key === "hh:joiners-house"));
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 · THE COUNT FLIPS AFTER THE BATCH — AND THE DOOR REFUSES A NEW PARCEL
// ═══════════════════════════════════════════════════════════════════════════

/** The clearing's step 5.6 resolver, exactly as clearing-job.mjs builds it. */
async function capResolver(store) {
  const { registry, pins } = registryOf(store.state);
  const walked = (hh) => resolveHouse(hh, registry, pins).slug;
  const counted = await soloCountedAt(store.q);
  return { counted, resolve: counted ? countingSolo(walked, registry, pins) : walked };
}

test("FALSIFIER 4 · before the batch the cap ignores solo: (POS-160's pin holds); after it, it counts them", async () => {
  // A fixture where the solo: rows are NOT adopted but the fact is set, to
  // isolate the count from the adoption: `solo:otto` must fold into `hh:over`.
  const store = worldStore();
  let { counted, resolve } = await capResolver(store);
  assert.equal(counted, false);
  let held = await heldParcelsByCred(store.q, { resolve });
  assert.equal(held.get("hh:over"), 3, "BEFORE: the cap sees 3 — the two solo: parcels stand apart (FALSIFIER 3d's gap)");
  assert.equal(held.get("solo:otto"), 1);

  store.state.acts.push({ id: "x", class: ADOPT_CLASS, action: COUNTED_ACTION });
  ({ counted, resolve } = await capResolver(store));
  assert.equal(counted, true);
  held = await heldParcelsByCred(store.q, { resolve });
  assert.equal(held.get("hh:over"), 5, "AFTER: the house's solo: parcels count");
  assert.equal(held.get("solo:otto"), undefined);
  assert.equal(held.get("solo:nobody"), 1, "a spelling no house holds keeps its own string — never guessed");
});

test("FALSIFIER 5 · after the batch the gate refuses a NEW parcel to the over-cap house, and says why; adoption itself was never refused", async () => {
  const store = worldStore();
  const r = await adoptSolo(store.client, { law: LAW });
  assert.equal(r.status, "adopted");
  const { counted, resolve } = await capResolver(store);
  assert.equal(counted, true);
  const heldByCred = await heldParcelsByCred(store.q, { resolve });
  assert.deepEqual([heldByCred.get("hh:under"), heldByCred.get("hh:at-cap"), heldByCred.get("hh:over")], [2, 3, 5]);

  const fresh = (slug, cred) => ({ id: slug, slug, cred: credOf(cred, resolve), date: "2026-09-24", amending: false });
  const verdict = parcelCapRefusals([
    fresh("otto/one-more", "hh:over"),
    fresh("atlas/one-more", "hh:at-cap"),
    fresh("ursa/one-more", "hh:under"),
    // an amendment by the over-cap house is a relocation, never refused (POS-88)
    { id: "otto/parcel-7", slug: "otto/parcel-7", cred: "hh:over", date: "2026-09-24", amending: true },
  ], { heldByCred, law: LAW });
  const refused = Object.fromEntries(verdict.refused.map((x) => [x.slug, x]));
  assert.deepEqual(Object.keys(refused).sort(), ["atlas/one-more", "otto/one-more"]);
  assert.equal(refused["otto/one-more"].check,
    `${PARCEL_CAP_CHECK}: otto/one-more — parcel claim capped — this credential household already holds 5 ` +
    "(cap 3 per household, ruled 2026-07-30; prior estate stands, new claims wait on the founder's word)");
  assert.ok(verdict.admitted.some((a) => a.slug === "ursa/one-more"), "the house under the cap is admitted");
  assert.ok(verdict.admitted.some((a) => a.slug === "otto/parcel-7" && a.amending), "an amendment is never refused");
});

test("FALSIFIER 6 · the plan HOLDS a mark whose owner stands in a different house, and STOPS on a spelling two houses hold", () => {
  const { registry, pins } = { registry: registryFromRows(rowsFromRegistry(REGISTRY, PINS)), pins: pinsFromRows(rowsFromRegistry(REGISTRY, PINS)) };
  const stray = { id: "s1", slug: "otto/stray", kind: "parcel", owner: "otto", household: "solo:ursa", status: "standing" };
  const p = planAdoption({ marks: [stray], registry, pins, cap: 3 });
  assert.equal(p.houses.length, 0);
  assert.match(p.held[0].why, /its owner "otto" stands in over/);

  const twice = structuredClone(REGISTRY);
  twice.households.over.residents.push("ursa");
  const r2 = registryFromRows(rowsFromRegistry(twice, PINS));
  const p2 = planAdoption({ marks: [{ ...stray, owner: "ursa" }], registry: r2, pins, cap: 3 });
  assert.equal(p2.stops.length, 1);
  assert.match(p2.stops[0], /solo:ursa is held by 2 houses/);
});
