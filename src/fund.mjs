// fund.mjs — the /fund door: a patron's tx hash becomes a witnessed pot receipt,
// or a refusal they are owed verbatim.
//
// This is S3's founder-manual seam with the hand-carrying taken out of the
// middle and NOTHING ELSE loosened. The witness is still a real on-chain fact
// (usdc-witness.mjs, ported check-for-check from the operator's CLI); the ledger
// is still the only place a receipt exists; the pen is still the office's.
// What changes is who runs it: the patron, once, at the moment they have the
// hash in hand — instead of a letter, a queue, and an operator's evening.
//
// THE ORDER OF THE GUARDS IS THE LAW, and it is deliberately front-loaded so a
// patron learns the answer before the chain is even consulted:
//
//   1. shape        — is this a tx hash, a pot name, a handle at all
//   2. the pot      — does the town post this need? (`treasury` is refused here:
//                     it takes direct-to-town receipts, never a fund page)
//   3. the resident — holo only ever mints to a town household (§ 8); an
//                     outsider's dollars are still recorded, but by the
//                     operator's hand, not at this door
//   4. the witness  — the four on-chain checks, and the confession of what they
//                     cannot see
//   5. whole dollars — see THE CENTS below
//   6. the ref      — "one dollar, one mint chance": already recorded, bounce
//   7. D5 headroom  — "intake refuses dollars past a pot's posted target,
//                     mechanically (recording tool / door bounce), except pots
//                     explicitly marked uncapped"
//   8. record       — the town's OWN epoch-close --receipt, under the flock
//
// Guards 6 and 7 are BOTH pre-checks AND enforced behind us: the town's
// `epoch-close.mjs --receipt` refuses a duplicate ref and refuses past-target
// dollars on its own, and stamp-verify refuses a duplicate ref that reached the
// ledger by any route at all. This door's copies exist to give the patron a
// clean sentence instead of a subprocess's FATAL — never to be the only guard.
// That is why they are checked with the town's own `intakeCheck` and the town's
// own `foldPotReceipts`, injected from the clone: one copy of the law.
//
// THE CENTS (a v0 decision, flagged for Keemin — NOT a ruling).
// The ledger's receipt grammar takes WHOLE dollars: `usd: [1-9]\d*`. USDC does
// not — the proven test payment was $83.93. Three answers were possible and two
// are worse than this one: refusing the row leaves a patron's irreversible
// on-chain money unrecorded, and widening the grammar to cents is a ledger-law
// change no build lane may make. So the receipt records floor(usd), the
// remainder is disclosed in the answer and on the page as money the town holds
// that priced nothing, and a payment under $1 is refused before it is sent
// rather than swallowed. This is the same shape as R1's "the seam keeps the
// change" — but R1 rules stamps, not dollars, so this leans on it by analogy
// and wants the founder's word before it is called law.

import { parseAccountRef, payerRegistry, fundHolder, meepLawOf } from "./fund-holder.mjs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";

import { verifyUsdcPayment, INTAKE, TXHASH_RE } from "./usdc-witness.mjs";
import { readIntakeMap, addressForPot } from "./intake-map.mjs";
import { isResidentHandle } from "./residency.mjs";
// The caption is LAW, and funding.mjs is where it lives. Two hand-typed
// copies stood here until the household door was built — the exact drift
// the single home exists to prevent, on the surface that can least afford it.
import { HOLO_CAPTION, WHAT_THIS_BUYS } from "./funding.mjs";
import { TREASURY_POT, classifyFundingRow } from "./funding.mjs";

export const POT_RE = /^[a-z0-9][a-z0-9-]*$/;

export const bounce = (code, defect, hint) => {
  const e = new Error(defect);
  Object.assign(e, { code, defect, hint });
  return e;
};

// The town's own engine, imported live from the clone — the stamps precedent
// (one source of truth for the rule). Returns null when the clone predates the
// seam, so the door can say "not yet open" instead of guessing at the law.
export async function townEngine(clone) {
  const mint = join(clone, "tools", "stamp-mint.mjs");
  if (!existsSync(mint)) return null;
  const m = await import(pathToFileURL(mint));
  if (typeof m.intakeCheck !== "function" || typeof m.foldPotReceipts !== "function") return null;
  return m;
}

/**
 * Everything the door can decide from the ledger + the pot file + the witness,
 * with no side effects and no network. Pure so the falsifiers can drive it.
 *
 * `engine` is the town's stamp-mint module (intakeCheck, foldPotReceipts,
 * potFile, keepingDial); `entries` is the parsed ledger.
 */
// The pot's own gate, split out so it can run BEFORE the chain is consulted.
// Order is not decoration here: a patron who names a pot the town does not post
// should learn that in the same second they ask, not after a round-trip to Base
// — and the town should not spend an RPC call proving a stranger's hash real
// before it knows there is anywhere for the money to go.
export function potGate({ engine, clone, pot }) {
  const potMeta = engine.potFile(clone, pot);
  if (!potMeta) return { ok: false, code: 404, defect: `no pot named "${pot}"`, hint: "the town posts its needs on the board — /board/ lists every open pot" };
  if (potMeta.status && potMeta.status !== "open")
    return { ok: false, code: 409, defect: `pot "${pot}" is ${potMeta.status}, not open`, hint: "a closed or draft pot takes no dollars; opening one is the founder's word" };
  return { ok: true, potMeta };
}

/**
 * The receipt refs a close has already settled. A holo row names the receipt it
 * settles in `ref:`, and the close writes one per receipt whether it minted
 * anything or not — so this set is the whole of "which payments have been
 * counted", zero-holo ones included. Reported by the guards; nothing branches
 * on it, and the town's own CLI and stamp-verify are what enforce it.
 */
export function settledRefs(entries) {
  const refs = new Set();
  for (const e of entries) {
    const row = classifyFundingRow(e.canonical);
    if (row?.kind === "holo") refs.add(row.ref);
  }
  return refs;
}

export function fundGuards({ engine, entries, clone, pot, handle, usd, receiptRef, households = null }) {
  const gate = potGate({ engine, clone, pot });
  if (!gate.ok) return gate;
  const { potMeta } = gate;

  // "one dollar, one mint chance — a re-recorded receipt bounces." Checked here
  // for the sentence; enforced by the town's CLI and by stamp-verify regardless.
  //
  // ONLY `receipts` is taken from the town's fold. The set of refs a close has
  // already settled is counted office-side, from the office's own reader, so
  // this door does not depend on the NAME the town's return happens to give
  // that set — a rename there would otherwise turn `settled` into `undefined`
  // here and this guard's count into a crash, silently, on a key nobody greps.
  const { receipts } = engine.foldPotReceipts(entries);
  const prior = receipts.find((r) => r.ref === receiptRef);
  if (prior) {
    return {
      ok: false, code: 409,
      defect: `this transaction is already recorded (${prior.date}, $${prior.usd} to pot ${prior.pot})`,
      hint: "one dollar, one mint chance — a payment is witnessed exactly once, when it crosses the seam. Your first submission is the one that counts; nothing was lost by submitting again.",
    };
  }

  // D5, with the town's own function so there is one copy of the rule.
  const dial = engine.keepingDial(clone);
  const intake = engine.intakeCheck({
    entries, pot, potMeta, usd, from: handle,
    treasury: dial?.treasury ?? null,
  });
  if (!intake.ok) {
    return {
      ok: false, code: 409, defect: intake.error,
      hint: intake.headroom > 0
        ? `this pot can still take $${intake.headroom} this epoch — send that much and the whole of it converts`
        : "this pot has what it asked for; the board has others, and the next epoch opens fresh",
      headroom: intake.headroom,
    };
  }
  return { ok: true, potMeta, headroom: intake.headroom, capped: intake.capped, receipts_settled: settledRefs(entries).size };
}

/**
 * POST /fund/verify — the whole flow. `record` is injected (fund-exec under the
 * town flock in production; a spy in the falsifiers) so the guards can be proven
 * without a pen, a clone push, or a chain.
 */
export async function fundVerify(clone, body, {
  verify = verifyUsdcPayment,
  record = null,
  engine = null,
  // Map(lowercased address -> pot), injected so a falsifier can drive a town
  // with per-pot addresses the shipped deploy/intake-addresses.json does not
  // have. Null reads the shipped file, which is what production does.
  potMap = null,
  // `{ houses, pins, residents }`, the payer registry (fund-holder.mjs §
  // payerRegistry), injected by a falsifier. Null reads the store, which is
  // what production does (POS-346).
  payers = null,
  // the caller's key, when there is one: its GitHub account is the payer's (see THE KEY, below)
  key = null,
} = {}) {
  const { txhash, pot } = body ?? {};
  let handle = body?.handle;
  // POS-317 (Keemin, 2026-10-02): a signed-in payer's form carries their account,
  // `household: "g<id>"`, minted by the fund page, and types nothing. It resolves
  // through src/fund-holder.mjs to the household's one holder, whose handle the
  // receipt's `from:` names, exactly as the card and PayPal rails resolve it.
  // A form that sends `handle` (older pages, a hand-built call) keeps that path.
  //
  // THE KEY, NOT THE BODY, SAYS WHOSE ACCOUNT IT IS (Wright's review of #331,
  // 2026-10-02). The body's `household` is a claim anyone can type. When the
  // call carries a signed-in key with a GitHub account, the account is the
  // KEY's: a body that names no account takes it, and a body that names a
  // DIFFERENT account is refused by name. A call with no such key (signed out,
  // or a static household key with no account) keeps the body's word, as before.
  const keyAccount = key?.ghId != null ? String(key.ghId) : null;
  if (keyAccount && body?.household != null && parseAccountRef(body.household) !== keyAccount)
    throw bounce(403, `household ${body.household} is not the account you are signed in as (g${keyAccount})`,
      "a payment goes in the name of the household your own sign-in holds; send no household and the door takes yours");
  // AND A HANDLE IS HELD TO THE SAME KEY (Plumb's review of #333, 2026-10-04):
  // a signed-in caller who names a handle instead of an account may name only a
  // resident its key acts for. Without this the 403 above was a door with a wall
  // beside it — `{ handle: "carol" }` from someone else's key credited carol.
  if (keyAccount && handle && key?.handles instanceof Set && !key.handles.has(String(handle)))
    throw bounce(403, `"${handle}" is not one of the residents you are signed in as`,
      `your key acts for ${[...key.handles].join(", ") || "no resident"} — name one of them, or send nothing and the payment goes to your own household`);
  const account = keyAccount && !handle ? `g${keyAccount}` : body?.household;
  let holder = null;

  // 1 · shape
  if (!txhash || !pot || (!handle && !account))
    throw bounce(422, "incomplete", 'required: { "txhash", "pot", and "household" (your account, g<id>, which the fund page fills in when you are signed in) or "handle" } — the transaction you sent, the pot you meant, and whose name it goes in');
  if (account && handle)
    throw bounce(422, "household and handle are two answers to one question", "send one: the fund page sends household when you are signed in");
  if (account && !parseAccountRef(account))
    throw bounce(422, "that is not an account reference", 'household is "g" followed by your GitHub account id, as the fund page fills it in');
  if (!TXHASH_RE.test(String(txhash)))
    throw bounce(422, "that is not a transaction hash", "a Base tx hash is 0x followed by 64 hex characters — copy it from your wallet or from basescan");
  if (!POT_RE.test(String(pot)))
    throw bounce(422, "that is not a pot name", "pot names are lowercase letters, digits and single hyphens — e.g. keeping-ec2");
  if (String(pot) === TREASURY_POT)
    throw bounce(422, `"${TREASURY_POT}" is the town's own direct line, not a pot`, "it takes direct-to-town receipts recorded by the founder's hand, never a funding page — pick a posted need from /board/");
  if (handle && !isResidentHandle(String(handle)))
    throw bounce(422, "that is not a handle", "lowercase letters, digits and single hyphens — the name you keep house under in town");

  const eng = engine ?? await townEngine(clone);
  if (!eng) throw bounce(409, "not-yet-open", "the office has no town clone with the funding seam — the door is dark until the seam merges");

  const { parseStampLedger } = eng;
  const { readFileSync } = await import("node:fs");
  const ledgerPath = join(clone, "WHITE_PAGES", "stamp-ledger.md");
  const entries = existsSync(ledgerPath) ? parseStampLedger(readFileSync(ledgerPath, "utf8")) : [];

  // 2 · the pot, BEFORE the chain (see potGate — the order is load-bearing)
  const gate = potGate({ engine: eng, clone, pot: String(pot) });
  if (!gate.ok) throw bounce(gate.code, gate.defect, gate.hint);

  // 3a · the household's holder, when the form named the account (POS-317).
  // POS-346: the account, and the handle below, are resolved from the store.
  let registry = payers;
  if (!registry) {
    try { registry = await payerRegistry(); }
    catch { throw bounce(503, "the town's household registry could not be read", "nothing was recorded — try again shortly"); }
  }
  if (account) {
    holder = fundHolder(parseAccountRef(account), { registry, isMeep: meepLawOf(eng, entries, new Date().toISOString().slice(0, 10)) });
    if (!holder)
      throw bounce(404, `no household holds account ${account}`, "holo mints to a town household, so this door needs a household the town knows. Not in town yet? Join first — or write to the postmaster and your dollars will be recorded by hand.");
    handle = holder.handle;
  }

  // 3 · the resident. § 8's holo law is household-shaped: a payer earns holo
  // only as a town household. An outsider's dollars are still welcome and are
  // still recorded — but by the founder's hand, not by a mint this door makes.
  if (!registry.residents.has(String(handle)))
    throw bounce(404, `no resident named "${handle}"`, "holo mints to a town household, so this door needs a handle the town knows. Not in town yet? Join first — or write to the postmaster and your dollars will be recorded by hand.");

  // 4 · the witness
  const addressMap = potMap ?? readIntakeMap().map;
  const w = await verify({ txhash: String(txhash), potMap: addressMap });
  if (!w.verified) {
    // An unreadable chain is a 503, not a refusal: the payment may be perfect.
    if (w.unreadable) throw bounce(503, "the town cannot see Base right now", w.refused);
    throw bounce(422, w.refused, "nothing was recorded, and nothing was lost — if you believe this is wrong, send the hash to the postmaster and it will be looked at by hand");
  }

  // ── 4a · THE CHAIN NAMED A POT ────────────────────────────────────────────
  // Two answers to "which need did this dollar mean" now exist: the claim in
  // the body, and — since the founder minted keeping-ec2 its own intake address
  // — the recipient address itself. When both spoke, they must agree.
  //
  // THE GRANDFATHER RULE, stated here in full because it is the half a reader
  // will assume is a bug:
  //
  //   A claim naming pot P verifies against P's own mapped address AND against
  //   the standing shared intake, because the shared address was the published
  //   answer for every pot up to the moment P's own address was minted.
  //   Refusing a tx that paid the shared address would strand an honest payer
  //   who followed yesterday's instructions, and yesterday's instructions were
  //   the town's own.
  //
  // So a shared-address payment (`to_pot === null`) passes for ANY pot, exactly
  // as it did before per-pot addresses existed, and will keep passing for as
  // long as any surface still shows the shared address — which is precisely
  // what deploy/intake-addresses.json's `_never` keeps true by refusing to map
  // it: "Do NOT map the shared intake address to a pot to make the queue go
  // away. That would make the office decide where a stranger's money went,
  // which is the one judgement this whole lane refuses to make."
  //
  // The union is NOT symmetric. Paying P's address while claiming Q is not
  // grandfathered: no published instruction ever pointed a Q-payer at P's
  // address, so the mismatch is a real disagreement and is bounced by name
  // rather than resolved in favour of either side. The claim is not silently
  // corrected to P — a payer may have paid the wrong address, or typed the
  // wrong pot, and the town does not know which.
  if (w.to_pot && w.to_pot !== String(pot)) {
    throw bounce(
      422,
      `the address you paid names a different pot — this transaction paid ${w.to}, which is pot "${w.to_pot}"'s own intake address, but the claim says pot "${pot}"`,
      `nothing was recorded and nothing was lost. Send it again naming "${w.to_pot}", or — if you truly meant "${pot}" — write to the postmaster, because the town will not move a dollar to a need its payer did not name.`,
    );
  }

  // 5 · whole dollars (see THE CENTS above)
  const whole = Math.floor(w.usd);
  const cents = Number((w.usd - whole).toFixed(6));
  if (whole < 1)
    throw bounce(422, `$${w.usd} is less than a dollar`, "the ledger records whole dollars, so a payment under $1 cannot be witnessed as a receipt. It reached the town and it is not lost — write to the postmaster.");

  // 6 + 7 · the ref and the headroom
  const g = fundGuards({ engine: eng, entries, clone, pot: String(pot), handle: String(handle), usd: whole, receiptRef: w.receipt_ref });
  if (!g.ok) throw bounce(g.code, g.defect, g.hint);

  // 8 · record, through the town's own CLI under the flock
  if (!record) throw bounce(409, "not-yet-open", "the office has no pen configured for the stamp-ledger");
  const written = await record({ pot: String(pot), usd: whole, from: String(handle), ref: w.receipt_ref });

  return {
    verified: true,
    recorded: true,
    pot: String(pot),
    handle: String(handle),
    // POS-317: the household the payment is in the name of, when the form named it
    ...(holder ? { household: holder.household, household_name: holder.name } : {}),
    txhash: w.txhash,
    usd_witnessed: w.usd,
    usd_recorded: whole,
    ...(cents > 0 ? {
      cents_note: `$${w.usd} arrived; the ledger records whole dollars, so $${whole} is witnessed against the pot and the remaining $${cents.toFixed(2)} is money the town holds that priced nothing. Nothing is lost and nothing is hidden — it simply bought no ownership.`,
    } : {}),
    from_address: w.from_address,
    to: w.to,
    // WHICH ADDRESS CARRIED THE CLAIM, recorded in the answer rather than left
    // implicit. Null means the payer used the standing shared intake and the
    // claim is the only thing naming the pot; a pot id means the chain named it
    // too, and agreed.
    to_pot: w.to_pot ?? null,
    block: w.block,
    confirmations: w.confirmations,
    receipt_ref: w.receipt_ref,
    headroom_before: g.headroom ?? null,
    headroom_after: g.capped ? Math.max(0, (g.headroom ?? 0) - whole) : null,
    line: written?.line ?? null,
    commit: written?.commit ?? null,
    caption: HOLO_CAPTION,
    what_this_buys: WHAT_THIS_BUYS,
  };
}

// ── the production recorder: fund-exec under the ferry's flock ───────────────
// The gift lane's ceremony exactly (ops.mjs → execUnderTownLock → *-exec.mjs).
// `date` is server-derived from the town clock, never from the body: a patron
// does not get to choose what day their dollar arrived.
//
// `rail` and `via` default to the /fund door's own pair, so every existing
// caller reads exactly as it did. They exist because tools/stripe-watch.mjs
// records the SAME row on a different rail, and one ledger writer serving two
// rails is the whole point — a second exec that also shelled
// `epoch-close --receipt` would be a second copy of the recording law.
export function penRecorder(clone, { execUnderTownLock, lockTimedOut, LOCK_BUSY, townDay, execPath, rail = "usdc", via = "the /fund door" }) {
  return async ({ pot, usd, from, ref }) => {
    const payload = JSON.stringify({ pot, usd, from, ref, date: townDay(), rail, via });
    let out;
    try {
      out = await execUnderTownLock(execPath, payload, { ...process.env, TOWN_CLONE: clone });
    } catch (e) {
      if (lockTimedOut(e)) throw bounce(LOCK_BUSY.code, LOCK_BUSY.defect, LOCK_BUSY.hint);
      throw bounce(500, "the receipt pass tripped", String(e.stderr ?? e.message ?? e).slice(0, 300));
    }
    const result = JSON.parse(out.trim().split("\n").at(-1));
    if (result.error) throw bounce(result.error.code ?? 500, result.error.defect, result.error.hint);
    return result;
  };
}

/** The wired door the server calls. */
export async function fundVerifyViaOffice(clone, body, { key = null } = {}) {
  const { execUnderTownLock, lockTimedOut, LOCK_BUSY } = await import("./town-lock.mjs");
  const { townDay } = await import("./ops.mjs");
  const { dirname, join: pjoin } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = dirname(fileURLToPath(import.meta.url));
  const record = penRecorder(clone, {
    execUnderTownLock, lockTimedOut, LOCK_BUSY, townDay,
    execPath: pjoin(here, "fund-exec.mjs"),
  });
  return fundVerify(clone, body, { record, key });
}

// ── THE PUBLISHED DISCLOSURE ────────────────────────────────────────────────
// One home for the words that must travel with the address. GET /fund/intake
// serves it, and so does the household door's money moment — extracted here
// when that door was built, because two copies of a §10 consent disclosure is
// two things that can drift, and the one that drifts is the one nobody reread.
//
// The two sentences every money surface carries, verbatim, are inside it.
//
// ── PER-POT, 2026-08-25 ─────────────────────────────────────────────────────
// `pot` is optional and it changes exactly one field: the address. A pot with
// its own mapped intake publishes THAT, so a patron reading its money moment
// pays an address that names the pot on the chain and needs no claim to be
// believed. A pot with none publishes the standing shared intake, which is
// where its patrons have always been sent.
//
// Derived from the map every time rather than remembered anywhere: the new
// address exists in deploy/intake-addresses.json and nowhere else in this
// repo's source, which is what makes minting the next one a one-file act.
//
// A pot the map somehow names twice publishes NO address (addressForPot returns
// null) rather than a guessed one — refuse or disclose, never quietly
// substitute, on the surface where substituting is money gone.
export function intakeDisclosure(pot = null, { map = null } = {}) {
  const potMap = map ?? readIntakeMap().map;
  const address = pot == null ? INTAKE : addressForPot(String(pot), potMap);
  return {
    ...(address
      ? { address }
      : {
          address: null,
          why: `the town's intake map names more than one address for pot "${pot}" — it will not choose between them, so this pot publishes no address until the map does. Write to the postmaster.`,
        }),
    ...(pot == null ? {} : { pot: String(pot) }),
    network: "Base",
    token: "USDC (Base native) only",
    min_confirmations: 12,
    whole_dollars: "the ledger records whole dollars; cents that arrive are money the town holds that priced nothing",
    recovery: "a wrong-network or wrong-token send is not recoverable by the town — best effort only, never a promise",
    caption: HOLO_CAPTION,
    what_this_buys: WHAT_THIS_BUYS,
    verify: "POST /fund/verify { txhash, pot, handle }",
  };
}

export { INTAKE };
