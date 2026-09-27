// fake-pen.mjs — a Postgres stand-in for the pen, small enough to read.
//
// WHY THIS EXISTS, and why it is not a mock of the pen. The mark lane's whole
// question is "did the act and its claim land on ONE client inside ONE
// transaction, in the order the door made them?" — and that question cannot be
// asked of a stub that swallows statements. It needs a store that actually
// holds rows and a transaction that can actually roll back, or an assertion
// about atomicity is an assertion about nothing.
//
// It also cannot be asked of the real store from a laptop. `world2-pen.mjs`
// reaches Postgres exactly one way — `const { default: pg } = await
// import("pg")` inside `pool()` — so `module.registerHooks` (node:module,
// synchronous, no CLI flag) resolves that ONE specifier to this file. Nothing
// in `src/` learns it is being tested: no injected pool, no test-only export,
// no seam in the pen that production has to carry. That is the point — a seam
// added for a test is a seam the pen would have to keep honest forever.
//
// WHAT IT MODELS, deliberately narrow: only the statements the mark lane's two
// halves issue (world2-pen § insertAct, world2-claims § claimTxFromJournal),
// dispatched by regex on the statement text rather than parsed. A statement it
// does not recognize THROWS by name — a silent `{rows:[]}` for an unrecognized
// statement is how a fake starts lying, and a test that passes against a lie is
// worse than no test. Extend it when the lane grows a statement; do not soften
// the throw.
//
// WHAT IT RECORDS: `log` is every statement in the order it was issued, tagged
// with the client that issued it. That is the whole apparatus for "one client,
// one transaction": if the act and the claim carry two different client ids, or
// a COMMIT sits between them, the assertion sees it.

let store = null;

/** A fresh empty store. `windows` starts with one open window — the docket
 *  refuses to take a claim without one, and that refusal is not what is on
 *  trial here (world2-claims § "no open window — the candle is dark"). */
export function resetStore({ identities = {}, failOn = null, connectDelay = null, queryDelay = null } = {}) {
  store = {
    acts: [], claims: [], windows: [{ id: 1, status: "open" }],
    // `marks` — the published register `markStandingStatus` reads (slug,
    // status, retired_window). Empty unless a test seeds it (postmark#3139).
    marks: [],
    identities: { ...identities },
    log: [], clients: 0, nextActId: 1000, nextClaimId: 1,
    // `failOn` is a predicate on the statement text: the pen made unreachable
    // at a CHOSEN moment, which is how "nothing was written" is proven rather
    // than asserted (a connect-refused pen only proves the easy case).
    failOn,
    // `connectDelay(opts)` — milliseconds a pool with THESE options waits
    // before handing over a connection. THE ADVERSARY, and it is modelled from
    // a live receipt rather than invented: on the box the compose's round trip
    // ran 113 ms behind and its own withdrawal's DELETE overtook it
    // (jetto-b1-guards-report § Finding 1).
    //
    // It is keyed on the POOL OPTIONS on purpose, because the two-queue disease
    // is visible right there: world2-claims opens `max: 2` and world2-pen opens
    // `max: 3`, and DESIGN §2 R1 names that pair as the illness — "two
    // independent pools with nothing joining them". Slowing the second pool is
    // therefore not stacking the deck; it is asking the only question that
    // distinguishes one queue from two. On a tree where the private-draft arm
    // rides the pen's own queue the second pool is never reached for this row
    // at all, so the delay is inert and the test still passes. A test that only
    // passes because the microtask scheduler happened to be kind is not a
    // falsifier, so the slowness stays in permanently.
    connectDelay,
    // `queryDelay(text)` — milliseconds a single statement takes. The
    // asymmetric adversary, and the one the mis-order actually needs: a compose
    // writes a body, a geometry and a bbox where a withdrawal writes a
    // predicate, so the two halves of one slug's life are NOT equally fast, and
    // on the box that inequality was 113 ms wide. Under one queue no statement
    // can be slow enough to reorder anything, because the withdrawal's
    // transaction cannot BEGIN until the compose's has COMMITted. Under two,
    // any inequality at all is enough. That asymmetry IS the test.
    queryDelay,
  };
  return store;
}
export function theStore() {
  if (!store) throw new Error("fake-pen: resetStore() first");
  return store;
}

/** Statements issued on committed transactions only — what the record actually
 *  holds, as opposed to what was attempted. */
export function committedLog() {
  return store.log.filter((e) => e.committed).map((e) => e.text);
}

/**
 * `household = ANY($n)` — the predicate, modelled (POS-160 RULING 4).
 *
 * The store never re-spells a row, so every household filter on `claims` takes
 * the acting house's SPELLING SET rather than its one current key. `asked` is
 * therefore an array, and this is membership.
 *
 * A BARE STRING IS STILL ACCEPTED, and not out of kindness: a client that could
 * not answer `current_setting` falls back to `[household]`, and a suite driving
 * one of the filters by hand may still pass a string. Both spell the same
 * question at one element.
 */
const oneOf = (asked, held) => (Array.isArray(asked) ? asked.includes(held) : asked === held);

const jsonGet = (v, k) => {
  if (v == null) return null;
  const o = typeof v === "string" ? JSON.parse(v) : v;
  return o?.[k] ?? null;
};

// ── `claims_update_guard`, MODELLED — the four transitions, and no fifth ────
//
// 007_private_drafts.sql § the transition guard. An office pen may compose a
// draft (draft -> draft), submit it (draft -> pending), or retract a pending
// claim (pending -> retracted); the only exemption is
// `current_user = 'clearing_job'`, which no door holds — and 007's own header
// says the table OWNER is bound too ("FORCE would make the TABLE OWNER subject
// to these policies … no runtime pen holds that role").
//
// WHY A FAKE HAS TO CARRY IT. Without this, an UPDATE the box would refuse
// simply assigns a field here and the suite goes green — the exact shape of
// failure this helper's header forbids ("a silent {rows:[]} for an unrecognized
// statement is how a fake starts lying"). And the pen has already paid for that
// once, in `world2-claims.mjs § promoteDraftOnStake`'s own words: "a second
// `UPDATE … SET data = data - '_deferred_act'` on the now-PENDING row is not
// one of the four transitions 007 permits, so it raised — after the promotion
// had already committed and the act had already been mirrored." A test that
// cannot reproduce that raise is a test that will let it happen again.
//
// The message is the guard's own, so a reader who hits it can grep the schema.
function guardTransition(from, to) {
  if (to === "draft" && from !== "draft")
    throw new Error(`claims: is already on the public docket and cannot become a draft again `
      + `— submit is the private/public boundary and it crosses once [attempted ${from} -> ${to}]`);
  if (from === "draft" && (to === "draft" || to === "pending")) return;
  if (from === "pending" && to === "retracted") return;
  throw new Error(`claims: office_api may compose a draft (draft -> draft), submit it `
    + `(draft -> pending), or retract a pending claim (pending -> retracted, fields untouched) `
    + `— nothing else, and never back to draft [attempted ${from} -> ${to}]`);
}

class FakeClient {
  constructor(id) { this.id = id; this.open = false; this.staged = []; }

  async query(text, params = []) {
    const t = String(text).replace(/\s+/g, " ").trim();
    const entry = { client: this.id, text: t, params, committed: false };
    store.log.push(entry);
    this.staged.push(entry);

    if (store.failOn && store.failOn(t, params)) throw new Error(`fake-pen: refused at "${t.slice(0, 60)}"`);
    const wait = store.queryDelay ? Number(store.queryDelay(t, params)) || 0 : 0;
    if (wait) await new Promise((r) => setTimeout(r, wait));

    if (/^BEGIN/i.test(t)) { this.open = true; return { rows: [], rowCount: 0 }; }
    if (/^COMMIT/i.test(t)) {
      this.open = false;
      for (const e of this.staged) e.committed = true;
      for (const w of this.writes ?? []) w();          // apply staged mutations
      this.writes = []; this.staged = [];
      return { rows: [], rowCount: 0 };
    }
    if (/^ROLLBACK/i.test(t)) {
      this.open = false; this.writes = []; this.staged = [];
      return { rows: [], rowCount: 0 };
    }
    // ── THE TWO SESSION SETTINGS (POS-160 RULING 4) ────────────────────────
    //
    // The store never re-spells a row — `acts_append_only`,
    // `claims_update_guard` and `marks_id_is_fixed` each refuse it — so a house
    // declares EVERY spelling it has ever carried and
    // `024_household_spellings.sql`'s four draft policies compare
    // `household = ANY(app.household_keys)`. `app.household` is still the one
    // CURRENT spelling.
    //
    // `_keys` IS MATCHED FIRST, and the ordering is load-bearing: `app.household`
    // is a prefix of `app.household_keys`, so a looser pattern above would let
    // the set overwrite the key and every assertion about "whose household is
    // acting" would be about the wrong string.
    if (/set_config\('app\.household_keys'/i.test(t)) {
      this.householdKeys = params[0] ? String(params[0]).split(",") : [];
      return { rows: [], rowCount: 0 };
    }
    if (/set_config\('app\.household'/i.test(t)) { this.household = params[0]; return { rows: [], rowCount: 0 }; }
    // `world2-claims.mjs § declaredKeys` reads the set back off the connection
    // rather than resolving the house a second time. Answered here the way a
    // real `string_to_array(NULLIF(…), ',')` answers: an array, or null.
    if (/current_setting\('app\.household_keys'/i.test(t))
      return { rows: [{ keys: this.householdKeys?.length ? this.householdKeys : null }], rowCount: 1 };

    // A statement outside a transaction is legal here (householdKeyFor and
    // promoteDraftOnStake read on the pool), and is applied immediately.
    const defer = (fn) => { if (this.open) (this.writes ??= []).push(fn); else fn(); };

    if (/SELECT household FROM identities/i.test(t))
      return store.identities[params[0]]
        ? { rows: [{ household: store.identities[params[0]] }], rowCount: 1 }
        : { rows: [], rowCount: 0 };

    // ── THE REGISTRY, AS `householdKeyFor` NOW READS IT (POS-160) ───────────
    //
    // The pen's resolver stopped reading `identities` and started reading the
    // registry that IS the record (`households` + `household_pins`), so this
    // fake has to answer those three SELECTs or every write path that resolves
    // a household dies here rather than at the thing under test.
    //
    // It answers them FROM THE SAME `identities` option, deliberately: a suite
    // that said "guards-alfa lives at gh:9000001" is making one statement about
    // one town, and making it say the same thing twice in two vocabularies is
    // how two fakes drift apart. One house per distinct key, its slug the key
    // with its prefix stripped, its residents the handles that share it. What
    // changes for a caller is the SPELLING the resolver hands back (`hh:9000001`
    // rather than `gh:9000001`), which is the whole point of the lane; no suite
    // in this repo asserts on that value, which was measured before it moved.
    if (/FROM households/i.test(t)) {
      const byKey = new Map();
      for (const [handle, key] of Object.entries(store.identities)) {
        const slug = String(key).replace(/^[a-z0-9-]+:/, "");
        if (!byKey.has(slug)) byKey.set(slug, []);
        byKey.get(slug).push(handle);
      }
      return {
        rows: [...byKey].map(([slug, residents], i) => ({
          slug, ord: i, name: null, human: null, accounts: [], residents,
          since: null, member_of: null, declared_by: null, formerly: [], provisional: false,
        })),
      };
    }
    if (/FROM household_pins/i.test(t)) return { rows: [] };
    if (/FROM registry_meta/i.test(t)) return { rows: [{ key: "schema_version", value: 1 }] };

    if (/FROM windows WHERE status = 'open'/i.test(t)) {
      const w = store.windows.filter((x) => x.status === "open").sort((a, b) => b.id - a.id)[0];
      return { rows: w ? [{ id: w.id }] : [], rowCount: w ? 1 : 0 };
    }

    // `world2-claims.mjs § markStandingStatus` (postmark#3139): the marks row,
    // standing first, with the OPEN window a pending claim on the slug rides.
    if (/FROM marks m WHERE m\.slug = \$1/i.test(t)) {
      const [slug] = params;
      const open = new Set(store.windows.filter((w) => w.status === "open").map((w) => w.id));
      const onDocket = store.claims.filter((c) => c.slug === slug && c.status === "pending" && open.has(c.window_id))
        .map((c) => c.window_id).sort((a, b) => b - a);
      const m = store.marks.filter((x) => x.slug === slug)
        .sort((a, b) => Number(b.status === "standing") - Number(a.status === "standing"))[0];
      return m
        ? { rows: [{ status: m.status, retired_window: m.retired_window ?? null, docket_window: onDocket[0] ?? null }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }

    if (/INSERT INTO acts/i.test(t)) {
      const id = store.nextActId++;
      const [at, crossing, actor, action, object, at_anchor, at_dx, at_dy, witnesses, cls, payload, effect, household, ...rest] = params;
      const row = { id, at, crossing, actor, action, object, at_anchor, at_dx, at_dy, witnesses, class: cls, payload, effect, household };
      // ⚑ `journal_seq` IS ONLY PRESENT IF THE PEN SENT IT. G1 (POS-156,
      // migration 025) drops that column and the pen stopped naming it; this
      // row used to carry the key unconditionally, which would have let a suite
      // assert the column's absence and pass while the pen still wrote it.
      // Spreading the rest, rather than destructuring a fourteenth parameter
      // into a named key, is what makes "the pen did not send it" and "the pen
      // sent null" different facts here -- which is the difference migration
      // 024 turns into a failed write on a real store.
      // Named, not positional, past the thirteenth: since migration 027 a say's
      // row may carry `nonce` there, and it must not be filed as `journal_seq`.
      const extra = (/INSERT INTO acts \(([^)]*)\)/i.exec(t)?.[1] ?? "").split(",").map((c) => c.trim()).slice(13);
      extra.forEach((c, i) => { row[c] = rest[i]; });
      defer(() => store.acts.push(row));
      return { rows: [{ id }], rowCount: 1 };
    }

    if (/DELETE FROM claims WHERE status = 'draft'/i.test(t)) {
      const [slug, claimant, household] = params;
      const hit = store.claims.filter((c) => c.status === "draft" && c.slug === slug && c.claimant === claimant && oneOf(household, c.household));
      defer(() => { for (const c of hit) store.claims.splice(store.claims.indexOf(c), 1); });
      return { rows: [], rowCount: hit.length };
    }

    if (/UPDATE claims SET status = 'retracted'/i.test(t)) {
      const [windowId, slug, claimant] = params;
      const hit = store.claims.filter((c) => c.window_id === windowId && c.status === "pending"
        && jsonGet(c.geometry, "slug") === slug && c.claimant === claimant);
      for (const c of hit) guardTransition(c.status, "retracted");
      defer(() => { for (const c of hit) { c.status = "retracted"; c.decided_at = "now"; } });
      return { rows: [], rowCount: hit.length };
    }

    if (/SELECT id FROM claims WHERE window_id = \$1 AND status = 'pending'/i.test(t)) {
      const [windowId, slug, claimant] = params;
      const hit = store.claims.filter((c) => c.window_id === windowId && c.status === "pending"
        && jsonGet(c.geometry, "slug") === slug && c.claimant === claimant);
      return { rows: hit.length ? [{ id: hit[hit.length - 1].id }] : [], rowCount: hit.length ? 1 : 0 };
    }

    // the promotion/rewrite of a held draft (world2-claims § the stake crossing the boundary)
    if (/UPDATE claims SET status = \$12/i.test(t)) {
      const [windowId, kind, body, geometry, bbox, stake, supersedes, data, slug, claimant, household, status] = params;
      const hit = store.claims.find((c) => c.status === "draft" && c.claimant === claimant && c.slug === slug && oneOf(household, c.household));
      if (!hit) return { rows: [], rowCount: 0 };
      guardTransition(hit.status, status);
      defer(() => Object.assign(hit, {
        status, class: kind, body, geometry, bbox, stake, supersedes, data, slug,
        ...(status === "pending" ? { window_id: windowId, submitted_at: "now" } : {}),
      }));
      return { rows: [{ id: hit.id }], rowCount: 1 };
    }

    if (/INSERT INTO claims/i.test(t)) {
      const [windowId, kind, claimant, household, body, geometry, bbox, stake, supersedes, data, slug, status] = params;
      const id = store.nextClaimId++;
      defer(() => store.claims.push({ id, window_id: windowId, class: kind, claimant, household, body, geometry, bbox, stake, supersedes, data, slug, status, submitted_at: "now" }));
      return { rows: [{ id }], rowCount: 1 };
    }

    // the promotion read in promoteDraftOnStake
    if (/SELECT id, data->'_deferred_act' AS held FROM claims/i.test(t)) {
      const [claimant, slug, household] = params;
      const c = store.claims.find((x) => x.status === "draft" && x.claimant === claimant && x.slug === slug && oneOf(household, x.household));
      if (!c) return { rows: [], rowCount: 0 };
      const data = typeof c.data === "string" ? JSON.parse(c.data) : (c.data ?? {});
      return { rows: [{ id: c.id, held: data._deferred_act ?? null }], rowCount: 1 };
    }
    if (/UPDATE claims SET status = 'pending', window_id/i.test(t)) {
      const [windowId, stamps, id, actId] = params;
      const c = store.claims.find((x) => x.id === id);
      if (!c) return { rows: [], rowCount: 0 };
      // The promotion is keyed on the row's ID alone, so unlike its siblings it
      // has no `status = 'draft'` in its own WHERE keeping it lawful — the
      // guard is the only thing standing between it and a second write onto a
      // row that has already gone pending.
      guardTransition(c.status, "pending");
      defer(() => {
        const data = typeof c.data === "string" ? JSON.parse(c.data) : (c.data ?? {});
        delete data._deferred_act;
        // the `|| jsonb_build_object('_act_id', …)` half of the one promotion
        // statement — the released act's identity, stamped as it is released
        if (actId != null) data._act_id = String(actId);
        Object.assign(c, { status: "pending", window_id: windowId, submitted_at: "now", stake: Math.max(Number(c.stake) || 0, Number(stamps) || 0), data: JSON.stringify(data) });
      });
      return { rows: [], rowCount: 1 };
    }

    throw new Error(`fake-pen: unmodelled statement — "${t.slice(0, 120)}". Model it or the test is asserting against a lie.`);
  }

  release() { this.open = false; }
}

export class Pool {
  constructor(opts) { this.options = opts; }
  async #wait() {
    const ms = store.connectDelay ? Number(store.connectDelay(this.options)) || 0 : 0;
    if (ms) await new Promise((r) => setTimeout(r, ms));
  }
  async connect() { await this.#wait(); return new FakeClient(++store.clients); }
  async query(text, params) { await this.#wait(); return new FakeClient(++store.clients).query(text, params); }
  async end() {}
}

export default { Pool };
