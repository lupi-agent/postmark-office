// stamp-sandbox-script.mjs — the stamp sandbox's script (POS-366): synthetic
// residents, a synthetic clock, and every stamp event the office knows, each
// driven through the code path the box runs and each with its expected outcome.
//
// tools/stamp-sandbox.mjs builds the throwaway town and store and runs this.
// A step is { id, event, title, run(ctx), expect, check?(ctx, result), verify? }:
//   run      does the act, through the real door, exec, watcher, drain or town tool
//   expect   the outcome, written from the LAW, never copied from a run:
//            { lines: {kind: n}, bal: {handle: Δ}, staked: {handle: Δ}, sums: [...] }
//            (tools/stamp-sandbox.mjs § judge). A resident not named must not move.
//   check    the step's own assertions beyond balances (a refusal, a plan, a read)
//   verify   run the town's full verifier after the step (every crossing does)
//
// THE CLOCK. Day 1 is the day after the ledger's (and the mail ledger's) tail,
// so every date the script writes is one the town's tools accept. One crossing
// per synthetic day; the month close jumps to the first day of the next month.
//
// THE RESIDENTS are `sbx-*` handles admitted through the drain and the ceremony
// on the throwaway store, so they cannot collide with a real resident, and the
// "nobody else moves" check holds every real balance still.
//
// Adding an event: append a step. Keep the expectation the law's, and cite the
// rule beside any number that is not obvious.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const GH = {
  ada: 990000001, bea: 990000002, cid: 990000003, dov: 990000004,
  eli: 990000005, fay: 990000006, gus: 990000007, hal: 990000008,
};
const H = (n) => `sbx-${n}`;
const login = (n) => `sbx-${n}-gh`;
export const POT = "sbx-box";
export const BALLOT = "sbx-vote";
export const MARK = "sbx-cid/the-lamp";
export const SANDBOX_RESIDENTS = [...Object.keys(GH).map(H), H("dex")];

const firstOfNextMonth = (date) => {
  const [y, m] = date.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
};

// ── the household half: the drain, the ceremony, settle-join, re-key ────────

/** The crossing's drain for join rows: plan each join, judge the split, write (src/town-bridge.mjs's order). */
async function drainJoins(ctx, joins, { date }) {
  const { loadRegistryRows } = await ctx.importOffice("src/registry-store.mjs");
  const { registryFromRows } = await ctx.importOffice("src/registry-rows.mjs");
  const { planRegistryJoin } = await ctx.importOffice("src/residency.mjs");
  const { writeTownDrain, currentKeysOf, plannedRegistryLines, householdKeySplits } = await ctx.importOffice("src/town-drain.mjs");
  const { collectingDrain } = await ctx.importOffice("src/ceremony.mjs");
  let working = registryFromRows(await loadRegistryRows());
  const plans = [];
  let seq = 0;
  for (const j of joins) {
    const row = {
      seq: ++seq, handle: j.handle, household: j.household ?? null, ghId: j.ghId, ghLogin: j.ghLogin,
      payload: { card: `I am ${j.handle}, a sandbox resident of the stamp sandbox.`, household: j.household ?? null, agent: j.handle, architecture: "sandbox", since: date },
    };
    const plan = planRegistryJoin(working, { handle: j.handle, household: j.household ?? null, ghId: j.ghId, ghLogin: j.ghLogin, date });
    working = plan.registry;
    plans.push({ row, plan });
  }
  const plan = { plans, registry: working, settle: plans.map((p) => p.row) };
  plan.ledger = plannedRegistryLines(plans, { date, keys: currentKeysOf(ctx.town) });
  const splits = householdKeySplits(ctx.town, plan.ledger.lines, plan.registry);
  if (splits.length) return { refused: "household-split", splits, plan };
  const touched = await writeTownDrain(ctx.town, plan, { date, drainWith: collectingDrain });
  if (touched.stalled?.length) throw new Error(`the drain stalled: ${touched.stalled.map((s) => s.why).join("; ")}`);
  if (touched.refused) throw new Error(`the registry did not render: ${touched.refused}`);
  ctx.commit(`ferry: town drain settled ${joins.map((j) => j.handle).join(", ")}`);
  return { plan, touched: [...touched] };
}

/** handle -> declared house slug, from the files the drain printed from the store. */
async function houseOf(ctx, handle) {
  const houses = JSON.parse(readFileSync(`${ctx.town}/tools/households.json`, "utf8")).households ?? {};
  return Object.entries(houses).find(([, r]) => (r.residents ?? []).includes(handle))?.[0] ?? null;
}

// ── the money half: the three rails, through their own deciders ──────────────

async function townFacts(ctx) {
  // POS-346: the watchers resolve the payer from the store (fund-holder.mjs §
  // payerRegistry: the registry rows and the town_residents roll the sandbox
  // ingests after every step), so the sandbox hands their deciders the same.
  const { payerRegistry, meepLawOf } = await ctx.importOffice("src/fund-holder.mjs");
  const { townEngine } = await ctx.importOffice("tools/stripe-watch.mjs");
  const engine = await townEngine(ctx.town);
  const entries = ctx.entries();
  const registry = await payerRegistry();
  return { engine, entries, households: registry.residents, registry, isMeep: meepLawOf(engine, entries, ctx.clock.date) };
}

const noonOf = (date) => Date.parse(`${date}T12:00:00Z`);

/** A card payment: stripe-watch's decide over a synthetic completed session, recorded through fund-exec. */
async function cardPayment(ctx, { id, usd, account = null }) {
  const sw = await ctx.importOffice("tools/stripe-watch.mjs");
  const { fundRefFor } = await ctx.importOffice("src/fund-holder.mjs");
  const facts = await townFacts(ctx);
  const now = noonOf(ctx.clock.date);
  const session = {
    id, created: Math.floor((now - 13 * 3_600_000) / 1000), amount_total: usd * 100, currency: "usd",
    client_reference_id: account ? fundRefFor(POT, account, "stripe") : POT,
    custom_fields: [], payment_status: "paid", livemode: true, payment_intent: null,
  };
  const { todo, report } = sw.decide({ sessions: [session], ...facts, clone: ctx.town, now });
  if (todo.length !== 1) return { refused: true, report };
  const w = todo[0];
  const out = ctx.exec("fund-exec", { pot: w.pot, usd: w.usd, from: w.from, ref: w.ref, date: ctx.clock.date, rail: sw.RAIL, via: "stripe-watch" });
  return { decided: w, out };
}

/** A PayPal payment: paypal-watch's decide over a synthetic transaction, recorded through fund-exec. */
async function paypalPayment(ctx, { id, usd, account = null }) {
  const pw = await ctx.importOffice("tools/paypal-watch.mjs");
  const facts = await townFacts(ctx);
  const now = noonOf(ctx.clock.date);
  const t = {
    transaction_info: {
      transaction_id: id, transaction_event_code: "T0006", transaction_status: "S",
      transaction_amount: { value: usd.toFixed(2), currency_code: "USD" },
      transaction_initiation_date: new Date(now - 13 * 3_600_000).toISOString(),
      custom_field: `${POT}|${account ? `g${account}` : ""}`,
    },
    payer_info: { email_address: "payer@sandbox.invalid" },
  };
  const { todo, report } = pw.decide({ transactions: [t], live: true, ...facts, clone: ctx.town, now });
  if (todo.length !== 1) return { refused: true, report };
  const w = todo[0];
  const out = ctx.exec("fund-exec", { pot: w.pot, usd: w.usd, from: w.from, ref: w.ref, date: ctx.clock.date, rail: pw.RAIL, via: "paypal-watch" });
  return { decided: w, out };
}

/** A USDC payment: the /fund door's own fundVerify, the chain read stubbed with the payment's facts, recorded through fund-exec. */
async function usdcPayment(ctx, { tx, usd, account = null, handle = null }) {
  const { fundVerify } = await ctx.importOffice("src/fund.mjs");
  const body = { txhash: tx, pot: POT, ...(account ? { household: `g${account}` } : { handle }) };
  const verify = async ({ txhash }) => ({
    verified: true, txhash, usd, from_address: "0x00000000000000000000000000000000000000aa",
    to: "0x00000000000000000000000000000000000000bb", to_pot: null, block: 1, confirmations: 99,
    receipt_ref: `usdc:base:${String(txhash).toLowerCase()}`,
  });
  const record = async ({ pot, usd: u, from, ref }) => {
    const out = ctx.exec("fund-exec", { pot, usd: u, from, ref, date: ctx.clock.date, rail: "usdc", via: "the /fund door" });
    if (out.error) throw Object.assign(new Error(out.error.defect), out.error);
    return out;
  };
  return fundVerify(ctx.town, body, { verify, record, potMap: new Map() });
}

// ── the script ───────────────────────────────────────────────────────────────

export function scenario(ctx) {
  const day = (n) => ctx.clock.addDays(ctx.clock.start, n - 1);
  const at = (n) => () => ctx.setDate(day(n));
  const state = {};
  const quest = async (handles) => {
    const { foldQuestProgress } = await ctx.importTown("tools/quest-progress.mjs");
    const prog = foldQuestProgress(ctx.town, { today: ctx.clock.date });
    return Object.fromEntries(handles.map((h) => [h, prog.get(h) ?? null]));
  };
  // the mint lines dated today, by side, for a handle (what the quest board must agree with)
  const mintedToday = (h) => {
    const out = { send: 0, receive: 0 };
    for (const e of ctx.entries()) {
      const c = ctx.engine.classifyEntry(e.canonical);
      if (c.kind !== "mint" || c.date !== ctx.clock.date || c.handle !== h) continue;
      if (/\(sent\)/.test(e.canonical)) out.send++;
      else if (/\(received\)/.test(e.canonical)) out.receive++;
    }
    return out;
  };

  return [
    // ── day 1 ──────────────────────────────────────────────────────────────
    {
      id: "00", event: "catch-up", verify: true,
      title: "the box's tick catch-up on the copied town, before any sandbox event: whatever mints and bundles the real town is owed at this sha",
      run: () => {
        at(1)();
        const mint = ctx.townTool("stamp-mint.mjs", ["--append", "--key", ctx.keyPath]);
        ctx.commit("mint: tick catch-up pass");
        const wel = ctx.officeTool("deploy/welcome-pass.mjs", ["--town", ctx.town, "--key", ctx.keyPath, "--date", ctx.clock.date], { allowFail: true });
        ctx.commit("mint: tick catch-up pass (welcome)");
        return { notes: [mint.out, wel.out].map((o) => o.trim().split("\n").at(-1)).filter(Boolean) };
      },
      // the real residents may move here and only here: from step 01 on, every one of them must hold still
      expect: { others: "may-move" },
      check: () => SANDBOX_RESIDENTS.filter((h) => ctx.holdings().bal.has(h)).map((h) => `${h} already holds stamps in the copied town`),
    },
    {
      id: "01", event: "admission", title: "the crossing's drain settles seven joins: seven houses through the ceremony, one registry line each",
      run: async () => {
        at(1)();
        const joins = ["ada", "bea", "cid", "eli", "fay", "gus", "hal"].map((n) => ({ handle: H(n), ghId: GH[n], ghLogin: login(n), household: `Sandbox ${n} house` }));
        return drainJoins(ctx, joins, { date: ctx.clock.date });
      },
      expect: { lines: { registry: 7 } },
      check: async (c, r) => {
        const p = [];
        if (r?.refused) p.push(`the drain refused: ${r.splits?.join(" · ")}`);
        for (const n of ["ada", "bea", "cid", "eli", "fay", "gus", "hal"]) if (!(await houseOf(ctx, H(n)))) p.push(`${H(n)} is in no house after the drain`);
        return p;
      },
    },
    {
      id: "02", event: "admission", title: "an unbound join (a hand-written join merged, not yet settled): a card, no pin, no house",
      run: async () => {
        const { buildJoinFiles } = await ctx.importOffice("src/residency.mjs");
        for (const f of buildJoinFiles({ handle: H("dov"), card: "I am sbx-dov, waiting for my bind.", ghLogin: login("dov"), since: ctx.clock.date })) {
          mkdirSync(dirname(join(ctx.town, f.path)), { recursive: true });
          writeFileSync(join(ctx.town, f.path), f.content);
        }
        ctx.commit("address: sbx-dov joins (hand-written, unsettled)");
      },
      expect: {},
    },
    {
      id: "03", event: "deliveries", verify: true,
      title: "crossing 1: deliveries mint both sides; six distinct recipients cap the sender's house at 5; a repeat and a self-letter mint nothing; the join bundle pays every bound house once and holds the unbound",
      run: () => {
        for (const to of ["bea", "cid", "eli", "fay", "gus", "hal"]) ctx.letter(H("ada"), H(to));
        ctx.letter(H("ada"), H("bea"), { slug: "again" });   // rule 2: one recipient once a day
        ctx.letter(H("ada"), H("ada"), { slug: "to-myself" }); // self-mail mints zero
        ctx.letter(H("bea"), H("ada"));
        return ctx.crossing();
      },
      // sends: ada's house 5 (cap 5 of 6 distinct), bea 1; receives: 6 from ada + ada's 1 from bea.
      // welcome: ✦5 to each of the seven bound houses' first resident; sbx-dov is unbound and waits.
      expect: {
        lines: { mint: 13, welcome: 7 },
        bal: { [H("ada")]: 5 + 1 + 5, [H("bea")]: 1 + 1 + 5, [H("cid")]: 6, [H("eli")]: 6, [H("fay")]: 6, [H("gus")]: 6, [H("hal")]: 6 },
      },
      check: async (c, r) => {
        const p = [];
        // the town's own plan, which the pass reads: the unbound house waits, it is not paid and not forgotten
        const plan = ctx.townTool("stamp-mint.mjs", ["--welcome-plan", "--date", ctx.clock.date]).out;
        const waiting = plan.split(/WAITING FOR A BIND/)[1]?.split("\n").find((l) => l.includes(H("dov")));
        if (!waiting) p.push("the town's welcome plan does not list sbx-dov as waiting for a bind");
        const q = await quest([H("ada"), H("bea")]);
        for (const h of [H("ada"), H("bea")]) {
          const m = mintedToday(h);
          if (q[h]?.send !== m.send || q[h]?.receive !== m.receive) p.push(`quest progress for ${h} reads ${JSON.stringify({ send: q[h]?.send, receive: q[h]?.receive })}, the ledger minted ${JSON.stringify(m)} today`);
        }
        if (q[H("ada")]?.household?.send !== 5) p.push(`ada's household quest reads ${q[H("ada")]?.household?.send} sends today, the cap is 5`);
        return p;
      },
    },

    // ── day 2 ──────────────────────────────────────────────────────────────
    {
      id: "04", event: "bind", title: "the bind: sbx-dov's join is settled by the office (settle-join, the hand road): a pin and a house of one, no ledger line",
      run: async () => {
        at(2)();
        const { settleUnderLock } = await ctx.importOffice("src/settle-join.mjs");
        const { NO_ADOPT } = await ctx.importOffice("src/ceremony.mjs");
        const r = await settleUnderLock({ handle: H("dov"), ghId: GH.dov, ghLogin: login("dov"), pr: 1, road: "hand", cardLogin: login("dov"), clone: ctx.town, date: ctx.clock.date, adopt: NO_ADOPT });
        ctx.commit("registry: sbx-dov settled");
        state.dovHouse = r.house.slug;
        return r;
      },
      expect: {},
      check: async (c, r) => {
        const pins = JSON.parse(readFileSync(`${ctx.town}/tools/github-ids.json`, "utf8"));
        return [
          ...(r?.settled ? [] : ["settle-join did not settle sbx-dov"]),
          ...(pins[H("dov")]?.id === GH.dov ? [] : ["sbx-dov has no pin after the bind"]),
        ];
      },
    },
    {
      id: "05", event: "deliveries", verify: true,
      title: "crossing 2: a letter that pays 2 moves 2; one that pays more than its sender holds voids and moves nothing; the bound house's bundle pays once",
      run: () => {
        ctx.letter(H("bea"), H("ada"), { pays: 2 });
        ctx.letter(H("cid"), H("ada"), { pays: 50 });   // rule 6: cid holds 6, so the transfer voids
        ctx.letter(H("ada"), H("bea"));
        return ctx.crossing();
      },
      // mints: bea send+receive, ada 2 receives + 1 send, cid 1 send; transfer bea→ada 2; void cid→ada; welcome sbx-dov ✦5
      expect: {
        lines: { mint: 6, transfer: 1, void: 1, welcome: 1 },
        bal: { [H("ada")]: 3 + 2, [H("bea")]: 2 - 2, [H("cid")]: 1, [H("dov")]: 5 },
      },
    },

    // ── day 3 ──────────────────────────────────────────────────────────────
    {
      id: "06", event: "household", title: "a merge: sbx-dex joins sbx-dov's house at the drain; the one-line plan is a split and is refused, the drain's plan re-keys the housemate too",
      run: async () => {
        at(3)();
        const { registryLine, householdKeySplits } = await ctx.importOffice("src/town-drain.mjs");
        // the shape that split nine houses (before #340): the joiner's line alone
        const oneLine = [{ seq: 1, handle: H("dex"), key: `hh:${state.dovHouse}`, line: registryLine(ctx.clock.date, H("dex"), state.dovHouse) }];
        const { loadRegistryRows } = await ctx.importOffice("src/registry-store.mjs");
        const { registryFromRows } = await ctx.importOffice("src/registry-rows.mjs");
        const reg = registryFromRows(await loadRegistryRows());
        reg.households[state.dovHouse].residents = [...reg.households[state.dovHouse].residents, H("dex")];
        state.splitOfOneLine = householdKeySplits(ctx.town, oneLine, reg);
        return drainJoins(ctx, [{ handle: H("dex"), ghId: GH.dov, ghLogin: login("dov"), household: null }], { date: ctx.clock.date });
      },
      expect: { lines: { registry: 2 } },
      check: async (c, r) => [
        ...(state.splitOfOneLine?.length ? [] : ["the split guard passed a plan that re-keys only the joiner"]),
        ...(r?.refused ? [`the drain refused its own plan: ${r.splits?.join(" · ")}`] : []),
        ...((await houseOf(ctx, H("dex"))) === state.dovHouse ? [] : ["sbx-dex is not in sbx-dov's house"]),
      ],
    },
    {
      id: "07", event: "deliveries", verify: true,
      title: "crossing 3: a merged house shares one cap (six distinct recipients across two handles mint 5); the join bundle is already paid for the house",
      run: () => {
        for (const to of ["ada", "bea", "cid"]) ctx.letter(H("dov"), H(to));
        for (const to of ["eli", "fay", "gus"]) ctx.letter(H("dex"), H(to));
        ctx.letter(H("ada"), H("bea"));
        ctx.letter(H("bea"), H("ada"));
        return ctx.crossing();
      },
      // receives: ada (dov, bea) 2, bea (dov, ada) 2, cid/eli/fay/gus 1; sends: ada 1, bea 1, the dov house 5 of 6
      expect: {
        lines: { mint: 15 },
        bal: { [H("ada")]: 3, [H("bea")]: 3, [H("cid")]: 1, [H("eli")]: 1, [H("fay")]: 1, [H("gus")]: 1 },
        sums: [{ handles: [H("dov"), H("dex")], bal: 5 }],
      },
      check: async () => {
        const q = await quest([H("dov"), H("dex")]);
        // the per-handle counts must match the ledger; the HOUSEHOLD grouping is a measured finding:
        // quest-progress.mjs groups by householdKeys (the base registry), not currentHouseholds, so a house
        // joined by `registry: … = hh:` lines reads as two houses on the board while the mint caps it as one
        const p = [];
        for (const h of [H("dov"), H("dex")]) {
          const m = mintedToday(h);
          if (q[h]?.send !== m.send) p.push(`quest progress for ${h} reads ${q[h]?.send} sends, the ledger minted ${m.send} today`);
        }
        const hh = q[H("dov")]?.household;
        if (hh?.send !== 5) p.push(`finding: the Quest Board's household for sbx-dov reads key ${hh?.key}, size ${hh?.size}, ${hh?.send} sends today, while the mint capped the merged house at 5 under one key (tools/quest-progress.mjs foldQuestProgress groups by householdKeys, not currentHouseholds; every house joined by an hh: registry line is affected)`);
        return p;
      },
    },

    // ── day 4 ──────────────────────────────────────────────────────────────
    {
      id: "08", event: "household", title: "a re-key: sbx-dov's house takes a new key (tools/rekey-household.mjs); a ledger line for each resident on the old key, no balance moves",
      run: async () => {
        at(4)();
        const { rekeyHousehold } = await ctx.importOffice("tools/rekey-household.mjs");
        const r = await rekeyHousehold({ from: state.dovHouse, to: "sbx-dov-hearth", name: "The Sandbox Hearth", clone: ctx.town, date: ctx.clock.date });
        state.dovHouse = "sbx-dov-hearth";
        return r;
      },
      expect: { lines: { registry: 2 } },
    },
    {
      id: "09", event: "ballot", title: "a ballot opens and sbx-ada stakes 3 through the stake door (stake-exec)",
      run: async () => {
        writeFileSync(`${ctx.town}/WHITE_PAGES/ballot-${BALLOT}.json`, JSON.stringify({
          topic: BALLOT, status: "staking", title: "The sandbox's vote", cap_per_household_per_candidate: 10, window_days: 7, candidates: ["yes", "no"],
        }, null, 2) + "\n");
        ctx.commit(`ballot: ${BALLOT} opens`);
        return ctx.exec("stake-exec", { handle: H("ada"), topic: BALLOT, candidate: "yes", n: 3, via: "api", date: ctx.clock.date });
      },
      // NO vote-mint: tools/ballot.mjs mints the +1 only while the law is stamps-v2, and it has been stamps-v3
      // since 2026-07-23 (last vote-mint line 2026-07-22). Flagged for Darko: did v3 mean to keep rule 4?
      expect: { lines: { stake: 1 }, bal: { [H("ada")]: -3 }, staked: { [H("ada")]: 3 } },
      finding: "no vote-mint on a first stake: tools/ballot.mjs:162 mints rule 4's +1 only while the law is stamps-v2, and the law has been stamps-v3 since 2026-07-23 (the ledger's last vote-mint is 2026-07-22). Whether v3 meant to keep rule 4 is Darko's ruling; the script asserts the code as it stands.",
      check: (c, r) => (r?.applied === 3 ? [] : [`the stake applied ${r?.applied ?? JSON.stringify(r?.error)}, expected 3`]),
    },
    {
      id: "10", event: "world-stake", title: "world-mark stakes: sbx-cid stakes 2 on a mark, sbx-eli stakes 1 (world-stake-exec)",
      run: () => [
        ctx.exec("world-stake-exec", { verb: "stake", handle: H("cid"), mark: MARK, n: 2, via: "api", date: ctx.clock.date }),
        ctx.exec("world-stake-exec", { verb: "stake", handle: H("eli"), mark: MARK, n: 1, via: "api", date: ctx.clock.date }),
      ],
      expect: { lines: { "world-stake": 2 }, bal: { [H("cid")]: -2, [H("eli")]: -1 }, staked: { [H("cid")]: 2, [H("eli")]: 1 } },
    },
    {
      id: "11", event: "world-unstake", title: "world-mark unstakes clip to the staker's own position: sbx-eli asks 2 and gets 1, sbx-cid takes 1 back, sbx-gus (no position) gets 0",
      run: () => [
        ctx.exec("world-stake-exec", { verb: "unstake", handle: H("eli"), mark: MARK, n: 2, date: ctx.clock.date }),
        ctx.exec("world-stake-exec", { verb: "unstake", handle: H("cid"), mark: MARK, n: 1, date: ctx.clock.date }),
        ctx.exec("world-stake-exec", { verb: "unstake", handle: H("gus"), mark: MARK, n: 1, date: ctx.clock.date }),
      ],
      expect: { lines: { "world-unstake": 2 }, bal: { [H("cid")]: 1, [H("eli")]: 1, [H("gus")]: 0 }, staked: { [H("cid")]: -1, [H("eli")]: -1, [H("gus")]: 0 } },
      check: (c, r) => (r?.[2]?.applied ? [`sbx-gus unstaked ${r[2].applied} from a mark it never staked`] : []),
    },
    {
      id: "12", event: "deliveries", verify: true,
      title: "crossing 4: a stake by mail (a ballot letter to the postmaster) lands through the ballot pass; a letter to a meep still mints its sender",
      run: () => {
        ctx.letter(H("bea"), "postmaster", { slug: "my-vote", fields: { stake_topic: BALLOT, stake_candidate: "no", stake_stamps: 2 } });
        ctx.letter(H("ada"), H("bea"));
        ctx.letter(H("bea"), H("ada"));
        return ctx.crossing();
      },
      // mints: bea sends 2 (ada, postmaster: rule 5, the meep's side mints nothing) and receives 1; ada sends 1, receives 1.
      // the ballot pass: bea stakes 2 on "no".
      expect: { lines: { mint: 5, stake: 1 }, bal: { [H("ada")]: 2, [H("bea")]: 3 - 2 }, staked: { [H("bea")]: 2 } },
    },

    // ── day 5 ──────────────────────────────────────────────────────────────
    {
      id: "13", event: "pot-stake", title: "a pot is posted and stamps go into it: sbx-cid stakes 4, sbx-gus stakes 2 (pot-stake-exec)",
      run: async () => {
        at(5)();
        writeFileSync(`${ctx.town}/WHITE_PAGES/pot-${POT}.json`, JSON.stringify({
          pot: POT, subtype: "bounty", status: "open", title: "The sandbox box", target_usd_per_epoch: null, epoch_cadence: "monthly",
          beneficiary: "keeminlee", received_usd: 0, uncapped: true, close: "elastic", min_close_usd: 5, first_close: firstOfNextMonth(ctx.clock.date),
        }, null, 2) + "\n");
        ctx.commit(`pot: ${POT} opens`);
        return [
          ctx.exec("pot-stake-exec", { handle: H("cid"), pot: POT, n: 4, via: "api", date: ctx.clock.date }),
          ctx.exec("pot-stake-exec", { handle: H("gus"), pot: POT, n: 2, via: "api", date: ctx.clock.date }),
        ];
      },
      expect: { lines: { "pot-stake": 2 }, bal: { [H("cid")]: -4, [H("gus")]: -2 }, staked: { [H("cid")]: 4, [H("gus")]: 2 } },
    },
    {
      id: "14", event: "pot-unstake", title: "a pot unstake (epoch-close --unstake, the founder's hand): sbx-gus takes 1 of its 2 back",
      run: () => {
        const r = ctx.townTool("epoch-close.mjs", ["--unstake", "--pot", POT, "--handle", H("gus"), "--n", "1", "--date", ctx.clock.date, "--via", "hand", "--key", ctx.keyPath]);
        ctx.commit(`pot: ${H("gus")} unstakes from ${POT}`);
        return r;
      },
      expect: { lines: { "pot-unstake": 1 }, bal: { [H("gus")]: 1 }, staked: { [H("gus")]: -1 } },
    },
    {
      id: "15", event: "gift", title: "a founder gift: ✦3 to sbx-fay (gift-exec)",
      run: () => ctx.exec("gift-exec", { handle: H("fay"), amount: 3, slug: "sandbox-thanks", by: "keemin", date: ctx.clock.date }),
      expect: { lines: { gift: 1 }, bal: { [H("fay")]: 3 } },
    },
    {
      id: "16", event: "fund", title: "a card payment, signed in: $10 in the name of sbx-bea's household (stripe-watch → fund-exec)",
      run: () => cardPayment(ctx, { id: "cs_sbx_card_signed_in", usd: 10, account: GH.bea }),
      expect: { lines: { "pot-receipt": 1 } },
      check: (c, r) => (r?.decided?.from === H("bea") && !r.out?.error ? [] : [`the card receipt went to ${r?.decided?.from ?? "nobody"} (${JSON.stringify(r?.out?.error ?? r?.report?.anomaly ?? null)})`]),
    },
    {
      id: "17", event: "fund", title: "a card payment, signed out: $5 is an outside gift (outside:stripe)",
      run: () => cardPayment(ctx, { id: "cs_sbx_card_signed_out", usd: 5 }),
      expect: { lines: { "pot-receipt": 1 } },
      check: (c, r) => (r?.decided?.from === "outside:stripe" && !r.out?.error ? [] : [`the signed-out card receipt went to ${r?.decided?.from ?? "nobody"}`]),
    },
    {
      id: "18", event: "fund", title: "a PayPal payment, signed in: $6 in the name of sbx-eli's household (paypal-watch → fund-exec)",
      run: () => paypalPayment(ctx, { id: "SBXPAYPALIN", usd: 6, account: GH.eli }),
      expect: { lines: { "pot-receipt": 1 } },
      check: (c, r) => (r?.decided?.from === H("eli") && !r.out?.error ? [] : [`the PayPal receipt went to ${r?.decided?.from ?? "nobody"} (${JSON.stringify(r?.out?.error ?? r?.report?.anomaly ?? null)})`]),
    },
    {
      id: "19", event: "fund", title: "a PayPal payment, signed out: $3 is an outside gift (outside:paypal)",
      run: () => paypalPayment(ctx, { id: "SBXPAYPALOUT", usd: 3 }),
      expect: { lines: { "pot-receipt": 1 } },
      check: (c, r) => (r?.decided?.from === "outside:paypal" && !r.out?.error ? [] : [`the signed-out PayPal receipt went to ${r?.decided?.from ?? "nobody"}`]),
    },
    {
      id: "20", event: "fund", title: "a USDC payment, signed in: $4 in the name of sbx-hal's household (the /fund door's fundVerify → fund-exec)",
      run: () => usdcPayment(ctx, { tx: `0x${"a1".repeat(32)}`, usd: 4, account: GH.hal }),
      expect: { lines: { "pot-receipt": 1 } },
      check: (c, r) => (r?.recorded && r.handle === H("hal") ? [] : [`the USDC receipt went to ${r?.handle ?? "nobody"}`]),
    },
    {
      id: "21", event: "fund", title: "a USDC payment, signed out: $2 with a typed handle (sbx-fay), the older form's road",
      run: () => usdcPayment(ctx, { tx: `0x${"b2".repeat(32)}`, usd: 2, handle: H("fay") }),
      expect: { lines: { "pot-receipt": 1 } },
      check: (c, r) => (r?.recorded && r.handle === H("fay") ? [] : [`the signed-out USDC receipt went to ${r?.handle ?? "nobody"}`]),
    },
    {
      id: "22", event: "friendship", verify: true,
      title: "crossing 5: the fifth letter each way between sbx-ada and sbx-bea reaches the first friendship rung (5:5), and the postmaster's ballot receipt reaches sbx-bea",
      run: () => {
        ctx.letter(H("ada"), H("bea"));
        ctx.letter(H("bea"), H("ada"));
        return ctx.crossing();
      },
      // mints: ada send+receive, bea send + receive from ada + receive from the postmaster's receipt letter
      // (rule 5: the meep's side mints nothing, the resident's still does); friendship: ✦5 to each side (rule 7)
      expect: { lines: { mint: 5, friendship: 2 }, bal: { [H("ada")]: 2 + 5, [H("bea")]: 3 + 5 } },
    },

    // ── day 6 ──────────────────────────────────────────────────────────────
    {
      id: "23", event: "ballot", title: "the ballot closes and every stake returns whole (ballot.mjs --close)",
      run: () => {
        at(6)();
        const p = `${ctx.town}/WHITE_PAGES/ballot-${BALLOT}.json`;
        writeFileSync(p, JSON.stringify({ ...JSON.parse(readFileSync(p, "utf8")), status: "closed" }, null, 2) + "\n");
        ctx.commit(`ballot: ${BALLOT} closes`);
        const r = ctx.townTool("ballot.mjs", ["--close", BALLOT, "--date", ctx.clock.date, "--key", ctx.keyPath]);
        ctx.commit(`ballot: ${BALLOT} returns`);
        return r;
      },
      expect: { lines: { return: 2 }, bal: { [H("ada")]: 3, [H("bea")]: 2 }, staked: { [H("ada")]: -3, [H("bea")]: -2 } },
    },
    {
      id: "24", event: "sweep", title: "the first-idea sweep holds its window: after 2026-09-30 it plans nothing",
      run: async () => {
        const { planFirstIdeaSweep } = await ctx.importOffice("src/first-idea-sweep.mjs");
        return planFirstIdeaSweep(ctx.town, { date: ctx.clock.date, ideas: [{ by: H("ada"), id: `${H("ada")}/an-idea`, slug: "an-idea" }] });
      },
      expect: {},
      check: (c, r) => (r?.mints?.length === 0 && /window closed/.test(r?.note ?? "") ? [] : [`the sweep planned ${r?.mints?.length} mint(s): ${r?.note ?? JSON.stringify(r)}`]),
    },

    // ── the month close ──────────────────────────────────────────────────────
    {
      id: "25", event: "month-close", verify: true,
      title: "the month closes the pot: every stake returns whole, one holo row per receipt, holo by dollar share of the staked mass (epoch-close --close)",
      run: () => {
        const epoch = day(5).slice(0, 7);
        ctx.setDate([firstOfNextMonth(day(5)), ctx.clock.date].sort().at(-1));
        const r = ctx.townTool("epoch-close.mjs", ["--close", "--pot", POT, "--epoch", epoch, "--date", ctx.clock.date, "--key", ctx.keyPath]);
        ctx.commit(`pot: ${POT} closes ${epoch}`);
        return r;
      },
      // returns: cid 4, gus 1 (the open mass, 5). The roll: $30 = 10 bea + 5 outside + 6 eli + 3 outside + 4 hal + 2 fay.
      // holo = floor(mass × the giver's dollars ÷ the roll), outside givers mint nothing:
      //   bea 5×10/30 = 1.67 → 1; eli 5×6/30 = 1; hal 5×4/30 → 0; fay 5×2/30 → 0; outside 0, 0. Six holo rows (n may be 0).
      expect: {
        lines: { "pot-return": 2, holo: 6 },
        bal: { [H("cid")]: 4, [H("gus")]: 1, [H("bea")]: 1, [H("eli")]: 1, [H("hal")]: 0, [H("fay")]: 0 },
        staked: { [H("cid")]: -4, [H("gus")]: -1 },
      },
    },
    {
      id: "26", event: "deliveries", verify: true,
      title: "a crossing in the new month: the mint carries on (one letter, both sides)",
      run: () => {
        ctx.letter(H("ada"), H("cid"));
        return ctx.crossing();
      },
      expect: { lines: { mint: 2 }, bal: { [H("ada")]: 1, [H("cid")]: 1 } },
    },
  ];
}

