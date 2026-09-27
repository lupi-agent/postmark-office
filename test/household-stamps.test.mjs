// household-stamps.test.mjs — the stamps tenancy's falsifiers.
//
// The four tenants exist because of the global principle (Keemin, 2026-08-23,
// dev/door-plan/DESIGN.md): "The website is a human interface DERIVED from the
// MCP. Never the other way around." So what these assert is that the doors
// answer what the portal renders — and that they answer it by the town's own
// law rather than by a copy of it.

import test from "node:test";
import { worldClone } from "./fixture-paths.mjs";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { readPots, foldFunding, parseLedgerText, WHAT_THIS_BUYS } from "../src/funding.mjs";
import { escrowDetail, fundRead, KEEPING_STAKE_MARK, STAKE_POT_BODY, POT_STAKEABLE_BODY } from "../src/household-stamps.mjs";
import { clipPotStake } from "../src/pot-stake-exec.mjs";
import { intakeDisclosure, INTAKE } from "../src/fund.mjs";
import { readIntakeMap } from "../src/intake-map.mjs";
import { HOUSEHOLD_DISPATCHABLE, HOUSEHOLD_READS, householdDispatchToolFor } from "../src/household-apex.mjs";

// A town whose WHITE_PAGES holds exactly the pot shapes the law now allows.
function tempTown(pots) {
  const dir = mkdtempSync(join(tmpdir(), "pm-doors-"));
  mkdirSync(join(dir, "WHITE_PAGES"), { recursive: true });
  for (const [name, body] of Object.entries(pots)) {
    writeFileSync(join(dir, "WHITE_PAGES", `pot-${name}.json`), JSON.stringify(body));
  }
  return dir;
}
// The keeping pot AS THE RECORD NOW READS IT. Its `close` word was made
// explicit on 2026-08-25; this fixture carried the pre-trueing silent shape,
// and a fixture that lags the record is a green suite asserting a world that
// no longer exists.
const EPOCH_POT = {
  pot: "keeping-ec2", status: "open", title: "Keep the lights on",
  target_usd_per_epoch: 150, epoch_cadence: "monthly", received_usd: 0, beneficiary: "keeminlee",
  close: "epoch", first_close: "2026-09-30",
};
const ELASTIC_POT = {
  pot: "darko-fund", status: "open", title: "The DARKO fund",
  target_usd_per_epoch: null, epoch_cadence: "monthly", received_usd: 0, beneficiary: "keeminlee",
  close: "elastic", min_close_usd: 5, first_close: "2026-09-30",
};
// THE DECOY. A pot that posts a target and names no close word at all — the
// genuinely-silent case, which must keep getting the humble answer. It exists
// so that teaching the doors the word `epoch` cannot quietly delete the path
// for a pot that never said one.
const SILENT_POT = {
  pot: "hushed", status: "open", title: "A pot that has not said how it closes",
  target_usd_per_epoch: 40, epoch_cadence: "monthly", received_usd: 0, beneficiary: "keeminlee",
};

// ── the amendment: a targetless pot is lawful when it says why ──────────────

test("a targetless pot with an elastic close word is READ, not refused", () => {
  // THE AMENDED LAW THIS ASSERTS — WHITE_PAGES/pot-keeping-ec2.json § _target,
  // town main 2026-08-23, quoted:
  //   "A pot with no target cannot close — unless its own close word says
  //    elastic (the DARKO ruling, 2026-08-23): then the need is whatever
  //    arrived, floored by its min_close_usd."
  // Until this reader carried that amendment the MCP literally dropped the
  // DARKO box: the town posted a need, and every door answered as though the
  // pot did not exist.
  const { pots, invalid } = readPots(tempTown({ "darko-fund": ELASTIC_POT, "keeping-ec2": EPOCH_POT, hushed: SILENT_POT }));
  assert.deepEqual(invalid, [], "no pot here is malformed");
  const darko = pots.find((p) => p.id === "darko-fund");
  assert.ok(darko, "the elastic pot must survive the read");
  assert.equal(darko.close, "elastic", "and carry its own word");
  assert.equal(darko.min_close_usd, 5, "and its floor");
  const ec2 = pots.find((p) => p.id === "keeping-ec2");
  assert.equal(ec2.close, "epoch", "the keeping pot carries the word its record now speaks");
  assert.equal(ec2.min_close_usd, null, "and no floor, because it posts a target instead");
  // THE DECOY, and the claim it protects: the reader's close word is an
  // ALLOWLIST, so a word it does not hold reads as null — "the record has not
  // said". A pot that genuinely has not said must land there, and only a pot
  // that genuinely has not said.
  const hushed = pots.find((p) => p.id === "hushed");
  assert.equal(hushed.close, null, "a pot that names no word carries null — not a guess");
});

test("a standing box is lawful too, and a targetless pot with NO word is still refused", () => {
  // `none` is the other word the law spells — pot-darko-fund.json § _close as
  // it read that morning: "a standing box, not an epoch pot". And the original
  // refusal keeps its remaining job: with no target AND no word, nothing in the
  // record says how the pot could ever close, so nothing should quote it a
  // funded fraction.
  const box = { ...ELASTIC_POT, pot: "tin", close: "none", min_close_usd: null };
  const mute = { ...ELASTIC_POT, pot: "mute", close: undefined, min_close_usd: null };
  const { pots, invalid } = readPots(tempTown({ tin: box, mute }));
  assert.deepEqual(pots.map((p) => p.id), ["tin"], "the standing box reads; the mute pot does not");
  assert.equal(invalid.length, 1);
  assert.match(invalid[0].reason, /no target_usd_per_epoch and names no close word/);
  assert.match(invalid[0].reason, /unless its own close word says elastic/,
    "the refusal quotes the amended law, so a reader learns which sentence bound them");
});

test("a fractional target is still refused — the amendment widened one door, not the wall", () => {
  const { pots, invalid } = readPots(tempTown({ frac: { ...EPOCH_POT, pot: "frac", target_usd_per_epoch: 150.5 } }));
  assert.deepEqual(pots, []);
  assert.match(invalid[0].reason, /positive whole number of dollars/);
});

// ── the escrow split ─────────────────────────────────────────────────────────

test("the escrow split explains the total and never replaces it", () => {
  const byHandle = new Map([["wright", new Map([["darko-fund", 4], ["keeping-ec2", 2]])]]);
  const e = escrowDetail({ total: 10, byHandle, handle: "wright" });
  assert.equal(e.total, 10, "the index's authoritative figure survives untouched");
  assert.deepEqual(e.by_pot, [{ pot: "darko-fund", staked: 4 }, { pot: "keeping-ec2", staked: 2 }]);
  // The remainder is NAMED. A split that covered only pots without saying so
  // would make ballot and world-mark escrow look like nothing.
  assert.equal(e.elsewhere, 4, "10 total − 6 in pots = 4 in ballots and marks");
  assert.match(e.note, /ballots and world marks/);
});

test("a handle with no pot escrow reads empty, never absent", () => {
  const e = escrowDetail({ total: 3, byHandle: new Map(), handle: "nobody" });
  assert.deepEqual(e.by_pot, []);
  assert.equal(e.elsewhere, 3, "all of it is elsewhere, and the read says so");
});

test("the per-handle fold agrees with the per-pot fold, by construction", () => {
  // Same rows, same three drains — only the key differs. If they could
  // disagree, one of the two numbers on a resident's card would be a lie.
  const ledger = [
    "- 2026-08-01 · wright → stake:pot/darko-fund · 4 · via: api",
    "- 2026-08-02 · iris → stake:pot/darko-fund · 6 · via: api",
    "- 2026-08-03 · stake:pot/darko-fund → wright · 1 · for: pot-return:2026-08",
  ].join("\n");
  const f = foldFunding(parseLedgerText(ledger));
  assert.equal(f.potEscrow.get("darko-fund"), 9, "4 + 6 − 1");
  const perHandle = [...f.potEscrowByHandle.values()]
    .reduce((n, m) => n + [...m.values()].reduce((a, b) => a + b, 0), 0);
  assert.equal(perHandle, f.potEscrow.get("darko-fund"), "the two folds must sum the same");
  assert.equal(f.potEscrowByHandle.get("wright").get("darko-fund"), 3, "4 staked, 1 returned");
});

// ── the pot-mode stake ───────────────────────────────────────────────────────

const state = (balances, meeps = []) => ({
  balances: new Map(Object.entries(balances)),
  lawAt: () => ({ meeps: new Set(meeps) }),
});
const POTS = [{ id: "darko-fund", data: { status: "open" } }, { id: "shut", data: { status: "closed" } }];

test("a keeping stake clips to the liquid balance and says what it applied", () => {
  const r = clipPotStake({ state: state({ wright: 3 }), pots: POTS, handle: "wright", pot: "darko-fund", n: 10, date: "2026-08-23" });
  assert.equal(r.applied, 3, "clipped to the balance");
  assert.equal(r.requested, 10);
  assert.equal(r.clipped, true);
  assert.equal(r.balance_after, 0);
});

test("a keeping stake refuses what the law refuses, in the law's own words", () => {
  const at = (patch) => clipPotStake({ state: state({ wright: 5 }, ["ferry"]), pots: POTS, handle: "wright", pot: "darko-fund", n: 2, date: "2026-08-23", ...patch });
  assert.equal(at({ n: 0 }).error.code, 422, "stakes move whole stamps");
  assert.equal(at({ n: 1.5 }).error.code, 422);
  assert.equal(at({ pot: "nope" }).error.code, 404, "a pot the town does not post");
  assert.equal(at({ pot: "shut" }).error.code, 409, "a pot that is not open takes neither dollars nor stakes");
  // stamps-v2: meeps neither mint nor stake — the same refusal clipApply gives,
  // because it is the same law and not a second copy of it.
  assert.equal(at({ handle: "ferry" }).error.code, 403);
  assert.match(at({ handle: "ferry" }).error.defect, /meep accounts cannot stake/);
  // nothing free to stake is an ANSWER, not an error — the ballot door's shape
  const broke = clipPotStake({ state: state({ wright: 0 }), pots: POTS, handle: "wright", pot: "darko-fund", n: 2, date: "2026-08-23" });
  assert.equal(broke.applied, 0);
  assert.match(broke.reason, /no stamps free to stake/);
});

test("the stake act quotes its residue class mark, never its own prose", () => {
  // The fold-in law: "every new act plants its residue class mark first and the
  // door quotes it, never its own prose."
  assert.equal(KEEPING_STAKE_MARK, "the-town/keeping-stake");
  // the PRIMARY residue moved to the mode class when the taxonomy was planted
  // (world main 3af43f61) — asserted in its own test below; here it is enough
  // that the act names a residue at all rather than speaking for itself.
  const src = readFileSync(new URL("../src/household-apex.mjs", import.meta.url), "utf8");
  assert.match(src, /stake: \{ tool: null, residue: "the-town\/[a-z-]+"/);
  assert.ok(HOUSEHOLD_DISPATCHABLE.includes("stake"), "and the act is dispatchable");
  assert.ok(HOUSEHOLD_DISPATCHABLE.includes("fund-verify"));
  // apex-only acts dispatch no flat tool — which is what makes them apex-only
  assert.equal(householdDispatchToolFor("stake"), null);
});

// ── the money moment ─────────────────────────────────────────────────────────

test("the address rides only beside an OPEN pot, never bare in the envelope", () => {
  // THE PUBLICATION LAW (the USDC runbook R9, quoted in fund.mjs's header):
  //   "The address publishes ONLY beside a pot (the money moment carries the
  //    disclosure, per §10's second consent gate) — never bare on a page."
  const db = {
    prepare: () => ({ all: () => [], get: () => undefined }),
  };
  // potBoard is exercised through fundRead's own guard; feed it directly here
  const answer = fundRead(null, { db, stripeUrl: "https://buy.stripe.com/x" });
  assert.equal(answer.read, "fund");
  const top = JSON.stringify({ ...answer, pots: "[elided]" });
  assert.equal(/0x[0-9a-fA-F]{40}/.test(top), false,
    "no address anywhere in the envelope — a caller reading only the top level never receives one");
  assert.match(answer.publication_law, /never bare/);
});

// ── the published close word ────────────────────────────────────────────────
//
// A db that serves potBoard exactly the pot files handed to it, and nothing
// else — no roll, no receipts, no escrow. The fund read is a read OF the pot
// files; the rest of the seam is another test's subject.
const potDb = (files) => ({
  prepare: (sql) => ({
    all: () => (/FROM pots\b/.test(sql) ? files.map((f) => ({ id: f.pot, json: JSON.stringify(f) })) : []),
    get: () => undefined,
  }),
});
const potIn = (answer, id) => answer.pots.find((p) => p.pot === id);

test("a pot whose word is `epoch` gets the contract stated, in the pot file's own sentence", () => {
  // THE LAW THIS ASSERTS — WHITE_PAGES/pot-keeping-ec2.json § source, quoted
  // verbatim, and the founder's explicit-word ruling of 2026-08-25 that made
  // the `close` field say out loud what this sentence had always ruled:
  //
  //   "at each month's close, the share of every stake that the month's dollars
  //    funded burns and splits between the stakers themselves and the payers
  //    per the keeping law (ECONOMY-DIALS.json law_side.keeping)"
  //
  // A caller consenting to a burn is owed the contract in the record's words.
  // Before the trueing this door gave the keeping pot the UNSTATED warning
  // while the public stamps page promised an epoch close — the same pot, two
  // readers, opposite answers, because each was deriving a word nobody spoke.
  const answer = fundRead(null, { db: potDb([EPOCH_POT]) });
  const ec2 = potIn(answer, "keeping-ec2");
  const pc = ec2.stakeable.published_close;
  assert.equal(pc.word, "epoch", "the door says the word the record speaks");
  assert.equal(pc.says,
    "At each month's close every stake comes home whole, and the stakes size the reward: the share of the staked mass that the month's dollars funded is minted fresh to the givers by dollar share, per the keeping law (ECONOMY-DIALS.json law_side.keeping)",
    "and states the contract in the pot file's own sentence, never a paraphrase of it (amended 2026-09-14: nothing burns)");
  // and the warning for a silent record is GONE from this pot, which is the
  // whole of what the resident found
  assert.equal("unstated" in pc, false,
    "a pot whose record speaks must not also be described as silent");
});

test("the WHOLE point: the humble path survives, for a pot that genuinely has not said", () => {
  // THE HONESTY THAT WAS NEVER THE BUG. household-stamps.mjs § CLOSE_UNSTATED,
  // quoted, and it must keep answering for a pot whose file names no word:
  //
  //   "this pot's file names no close word — nothing in the record says when,
  //    or whether, a stake on it would burn"
  //
  // The defect was one pot's SILENT RECORD, not the reader that said so. This
  // decoy is here so that teaching the door `epoch` cannot quietly delete the
  // path a wordless pot still needs.
  const answer = fundRead(null, { db: potDb([EPOCH_POT, SILENT_POT]) });
  const hushed = potIn(answer, "hushed").stakeable.published_close;
  assert.equal(hushed.word, null, "no word is a real answer, not a missing field");
  assert.equal(hushed.floor_usd, null);
  assert.equal(hushed.unstated,
    "this pot's file names no close word — nothing in the record says when a stake on it would come home",
    "the humble sentence stands exactly as written");
  assert.equal("says" in hushed, false,
    "and no contract is stated for a pot that stated none");
  // the two pots in one answer: the epoch pot did NOT drag the silent one with it
  assert.equal(potIn(answer, "keeping-ec2").stakeable.published_close.word, "epoch");
});

test("a word the law spells elsewhere is passed through as said, with no invented copy", () => {
  // `elastic` and `none` are the other two words the law spells
  // (pot-darko-fund.json § _close). The door carries them and does not write
  // prose for them here — the elastic contract lives in the pot's own file, and
  // a second copy on this door is a second thing that can drift.
  const answer = fundRead(null, { db: potDb([ELASTIC_POT]) });
  const pc = potIn(answer, "darko-fund").stakeable.published_close;
  assert.equal(pc.word, "elastic");
  assert.equal(pc.floor_usd, 5, "and the floor rides with the word");
  assert.equal("unstated" in pc, false, "a said word is not a silence");
  assert.equal("says" in pc, false, "and the door invents no contract sentence for it");
});

test("the fund read names WHEN the first close runs, for every pot that has one", () => {
  // THE LAW — pot-keeping-ec2.json § _first_close, quoted (founder's ruling,
  // 2026-08-25 beta-launch sitting):
  //
  //   "the pots opened in late August with $0 received, so the first epoch
  //    ROUNDS FORWARD — the first month closes at the END of September; dollars
  //    arriving before then all belong to the 2026-09 epoch. Surfaces render
  //    the epoch from this field, not from the posting date."
  //
  // This read carried the cadence and the target and never the day, on the one
  // surface where a caller is deciding whether to send money.
  const answer = fundRead(null, { db: potDb([EPOCH_POT, ELASTIC_POT, SILENT_POT]) });
  assert.equal(potIn(answer, "keeping-ec2").first_close, "2026-09-30");
  // NOT only the epoch pots — the elastic box names one too, and a read that
  // surfaced the date for one kind of pot and not the other would have made the
  // field look like a property of the word rather than of the pot.
  assert.equal(potIn(answer, "darko-fund").first_close, "2026-09-30");
  // and null, not absent, on a pot that names none
  assert.equal(potIn(answer, "hushed").first_close, null);
});

test("the disclosure has ONE home, and it carries both mandated sentences", () => {
  // Extracted when this door was built: GET /fund/intake and the household
  // money moment serve the same object, because two copies of a §10 consent
  // disclosure is two things that can drift.
  const d = intakeDisclosure();
  assert.equal(d.caption, "a record of contribution, not a promise of profit");
  // AMENDED 2026-09-17: and the SENTENCE has one home too now, not just the
  // object. funding.mjs owns it; both fund.mjs sites import it, where they used
  // to type it out — two copies of a § 10 consent disclosure is two things that
  // can drift, which is the claim the test above this one already makes.
  assert.equal(d.what_this_buys, WHAT_THIS_BUYS);
  assert.match(d.address, /^0x[0-9a-fA-F]{40}$/);
  // Aimed at the CLAIM, not the spelling: the route must hand back
  // intakeDisclosure's own object and never assemble a second one. It grew a
  // ?pot argument on 2026-08-25, which changed the call and nothing about the
  // claim — a probe pinned to `intakeDisclosure()` would have gone red for a
  // change that was exactly what it wanted.
  const server = readFileSync(new URL("../src/server.mjs", import.meta.url), "utf8");
  assert.match(server, /return j\(res, 200, intakeDisclosure\([^)]*\)\);/,
    "the REST route serves the shared object rather than its own copy");
  const route = server.slice(server.indexOf('path === "/fund/intake"'), server.indexOf('path === "/fund/intake"') + 900);
  assert.equal(/address:|caption:|what_this_buys:/.test(route), false,
    "and it composes none of the disclosure's fields itself");
});

test("the card rail is handed to a human, never executed by the agent", () => {
  // DESIGN.md: "Stripe rides as a door-served checkout link an agent hands its
  // human — cards are human instruments; agent-MEDIATED, never agent-executed."
  const src = readFileSync(new URL("../src/household-stamps.mjs", import.meta.url), "utf8");
  assert.match(src, /card_checkout_url/);
  assert.match(src, /hand this to your human/);
  assert.equal(/fetch\(|POST .*stripe/i.test(src), false,
    "the door hands over a link and never transacts a card itself");
});

test("fund-verify wraps the eight-guard door and never reimplements it", () => {
  // fund.mjs's header: "THE ORDER OF THE GUARDS IS THE LAW." A second
  // implementation would be a second order.
  const src = readFileSync(new URL("../src/household-apex.mjs", import.meta.url), "utf8");
  assert.match(src, /case "fund-verify": \{[\s\S]*?fundVerifyViaOffice\(clone, fields\)/,
    "the act calls fund.mjs's own implementation");
  assert.equal(/verifyUsdcPayment|intakeCheck|foldPotReceipts/.test(src), false,
    "and the apex holds no guard of its own");
});

test("the mandated sentences are imported, never hand-typed, on every money surface", () => {
  // funding.mjs owns the sentence ("exact wording is law — Keemin's word, seam
  // night 2026-08-21"). fund.mjs carried TWO hand-typed copies of it until this
  // door was built, which is two things that can drift on the surface that can
  // least afford drift. Found by this probe's own can-fail flip: mutating one
  // copy left the other green.
  //
  // WIDENED 2026-09-17: the money-moment disclosure `what_this_buys` was in
  // EXACTLY the same state — typed out twice in fund.mjs with nothing
  // cross-checking the copies — and it went unnoticed because this probe named
  // only the caption. It is now `WHAT_THIS_BUYS` in funding.mjs, imported at
  // both sites, and under the same discipline here. A probe that guards one
  // mandated sentence on a surface that carries two is a probe with a hole.
  const HAND_TYPED = [
    [/caption: "a record of contribution, not a promise of profit"/g, "HOLO_CAPTION"],
    [/what_this_buys: "this buys /g, "WHAT_THIS_BUYS"],
  ];
  for (const f of ["../src/fund.mjs", "../src/household-stamps.mjs"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    for (const [re, name] of HAND_TYPED) {
      assert.deepEqual(src.match(re) ?? [], [],
        `${f} hand-types a mandated sentence instead of importing ${name}`);
    }
  }
  const fund = readFileSync(new URL("../src/fund.mjs", import.meta.url), "utf8");
  // Aimed at the IMPORT, not at the exact spelling of the import line: this
  // pinned the whole line and went red the moment a second mandated constant
  // joined it, which is a pin reading its neighbours rather than its subject.
  const imported = fund.match(/import \{([^}]*)\} from "\.\/funding\.mjs";/g) ?? [];
  const names = imported.join(" ");
  for (const n of ["HOLO_CAPTION", "WHAT_THIS_BUYS"]) {
    assert.ok(names.includes(n), `fund.mjs must import ${n} from funding.mjs`);
  }
  assert.equal((fund.match(/caption: HOLO_CAPTION,/g) ?? []).length, 2,
    "both money answers read the one caption constant");
  assert.equal((fund.match(/what_this_buys: WHAT_THIS_BUYS,/g) ?? []).length, 2,
    "and both read the one disclosure constant");
});

// ── the planted taxonomy, quoted verbatim ────────────────────────────────────

test("the door quotes the planted mark bodies VERBATIM, from the world record itself", () => {
  // THE QUOTE LAW: "every new act plants its residue class mark first and the
  // door quotes it, never its own prose." A paraphrase is the drift class that
  // law exists to kill — so this reads the MARK FILES, not the door's copy of
  // them. If the two ever disagree, the record is right and the door is a bug.
  //
  // Skipped, never faked, when no world checkout is at hand: a green tick that
  // proved nothing would be worse than an honest absence.
  const roots = [worldClone()].filter(Boolean);
  const base = "WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works";
  const paths = {
    [STAKE_POT_BODY]: `${base}/postmark-edge/stake/stake-pot/mark.md`,
    [POT_STAKEABLE_BODY]: `${base}/postmark-node/paper/pot/pot-stakeable-slot/mark.md`,
  };
  let checked = 0;
  for (const [body, rel] of Object.entries(paths)) {
    let text = null;
    for (const root of roots) {
      if (!root) continue;
      try { text = readFileSync(join(root, rel), "utf8"); break; } catch { /* next root */ }
    }
    if (text == null) continue;
    checked++;
    // the mark's prose is everything after its frontmatter
    const prose = text.slice(text.indexOf("---", 3) + 3).trim();
    assert.ok(prose.includes(body),
      `the door's copy of ${rel} is a paraphrase:\n  door:   ${body}\n  record: ${prose.slice(0, 200)}`);
  }
  if (!checked) {
    console.log("      ↳ no world checkout on this box — the verbatim check did not run");
    return;
  }
  assert.equal(checked, 2, "both marks must be checked when the record is readable");
});

test("the stake answer and the fund read carry the menu and the mode, not a summary", () => {
  const src = readFileSync(new URL("../src/household-stamps.mjs", import.meta.url), "utf8");
  // the answer quotes both axes: the object's menu and the edge's mode
  assert.match(src, /stakeable: \{ slot: "stakeable", value: "pot-mode — returns whole at the published close", mark: POT_STAKEABLE_SLOT, says: POT_STAKEABLE_BODY \}/);
  // BOTH surfaces carry the mode — the stake's answer and the fund read's
  // consent payload. Counting matters: a single-match check stayed green when
  // the stake answer dropped its copy and the fund read kept one.
  // THREE since POS-83: the PREVIEW carries it too, because what a caller is
  // being asked to consent to is the whole reason for asking first — a preview
  // that showed the numbers and withheld the mode would be the summary this
  // test exists to refuse, one door earlier.
  assert.equal((src.match(/mode: \{ mark: STAKE_POT_MARK, says: STAKE_POT_BODY \}/g) ?? []).length, 3,
    "the mode class rides the stake's PREVIEW, the stake answer AND the fund read's menu");
  // NO MODE ARGUMENT, and the door says why rather than leaving it a silence.
  //
  // This asserted the SOURCE LITERAL `stake: { from: 1, pot: 1, stamps: 1 }`
  // until the actions grammar landed (2026-08-23) and turned that presence map
  // into a real field schema — a rewrite that changed nothing about which
  // fields the act takes, and broke the probe anyway, because the probe was
  // pinned to the spelling rather than to the claim. Re-aimed at the ANSWER: it
  // now reads the fields off the door itself, where a mode argument would
  // actually have to appear to do any harm.
  const apex = readFileSync(new URL("../src/household-apex.mjs", import.meta.url), "utf8");
  assert.equal(/\bmode\s*:/.test(apex), false, "no mode field is declared anywhere on the door");
  assert.match(src, /the object publishes the menu and the edge records the choice/);
  // the consent payload rides the fund read, BEFORE the money moment
  const fundRead = src.slice(src.indexOf("export function fundRead"));
  const menuAt = fundRead.indexOf("stakeable:");
  const moneyAt = fundRead.indexOf("money_moment:");
  // PRESENT, and only then BEFORE. `-1 < n` is true, so an ordering check alone
  // went green when the menu was deleted outright — which its own flip proved.
  assert.ok(menuAt > 0, "the fund read must carry the menu at all");
  assert.ok(moneyAt > 0 && menuAt < moneyAt,
    "the menu a caller is consenting to must come before the address they act on");
  // anchored: a renamed key still contains the old name as a substring. The
  // shape moved into publishedClose() when the door learned the `epoch` word —
  // the claim is unchanged, only where the object is built.
  assert.match(fundRead, /\bpublished_close: publishedClose\(p\)/);
});

test("the stake's fields, read off the door: from, pot, stamps — and no mode", async () => {
  // The behavioural half of the claim above. THE TAXONOMY (world main 3af43f61):
  // the OBJECT publishes the menu and the EDGE records the choice, so every
  // serviceable menu offers exactly one mode and the mode is IMPLIED BY THE
  // TARGET. A `mode` argument here would be the door inviting a caller to
  // contradict the record.
  const { householdApex } = await import("../src/household-apex.mjs");
  const answer = await householdApex({}, { household: "testers", handles: new Set(["tester"]) },
    { db: null, schemas: {}, schemaRequired: {} });
  const stake = answer.acts.find((a) => a.act === "stake");
  assert.ok(stake, "the stake must be among the acts the door publishes");
  // ASKED OF THE REQUIRED SET, not of every key (POS-83). The claim is about
  // which fields this act TAKES TO ACT — `preview` joined the card as an opt-in
  // that moves nothing, and a flat key list cannot tell that apart from a mode
  // argument sneaking in. So: the three that are required are still exactly
  // these three, and the only other field is the one that writes nothing.
  const required = Object.entries(stake.fields).filter(([, f]) => f.required).map(([k]) => k).sort();
  assert.deepEqual(required, ["from", "pot", "stamps"]);
  assert.deepEqual(Object.keys(stake.fields).sort(), ["from", "pot", "preview", "stamps"]);
  assert.equal(stake.fields.preview.required, undefined, "the founder ruled opt-in — a required preview would be the forced two-step he refused");
  assert.equal("mode" in stake.fields, false, "a mode argument would contradict the taxonomy");
});

test("the primary residue is the mode class, with keeping law still citable", () => {
  const apex = readFileSync(new URL("../src/household-apex.mjs", import.meta.url), "utf8");
  assert.match(apex, /stake: \{ tool: null, residue: "the-town\/stake-pot"/,
    "stake-pot is the primary residue now");
  assert.equal(KEEPING_STAKE_MARK, "the-town/keeping-stake", "and the keeping law stays citable");
});

test("the money moment carries the POT'S OWN address, from the shipped map", () => {
  // LAW (deploy/intake-addresses.json, verbatim): "WHICH POT A USDC ARRIVAL
  //     PAYS, read off the address it landed on. An ERC-20 transfer carries no
  //     memo, so the ONLY way the chain can name a pot is for the pot to have
  //     its own intake address."
  //
  // Read against the SHIPPED map rather than a fixture, because what this
  // asserts is that the door and the map agree about the town as it actually
  // stands today: keeping-ec2 has an address of its own (minted 2026-08-25),
  // darko-fund does not and keeps the standing shared intake.
  const { map } = readIntakeMap();
  const answer = fundRead(null, { db: potDb([EPOCH_POT, ELASTIC_POT]) });

  const keeping = potIn(answer, "keeping-ec2").money_moment;
  const darko = potIn(answer, "darko-fund").money_moment;
  assert.ok(keeping && darko, "both pots are open, so both carry a money moment");

  assert.equal(keeping.address, map.get(keeping.address.toLowerCase()) ? keeping.address : null,
    "the address keeping-ec2 publishes is one the map knows");
  assert.equal(map.get(keeping.address), "keeping-ec2",
    "and the map says it names keeping-ec2 — the chain can name the pot without a claim");
  assert.equal(darko.address, INTAKE,
    "a pot with no address of its own publishes the standing shared intake");
  assert.notEqual(keeping.address, darko.address,
    "two pots, two addresses — which is the whole point of minting one");

  // each says which pot it is for, so a caller holding one cannot lose track
  assert.equal(keeping.pot, "keeping-ec2");
  assert.equal(darko.pot, "darko-fund");

  // and every OTHER word of the §10 disclosure is still the one shared copy
  for (const k of ["network", "token", "min_confirmations", "whole_dollars", "recovery", "caption", "what_this_buys"])
    assert.equal(keeping[k], darko[k], `${k} did not fork when the address did`);
});

test("a pot that is not open publishes no address, per-pot map or not", () => {
  // THE PUBLICATION LAW (the USDC runbook R9): "The address publishes ONLY
  //     beside a pot" — and a pot the town has not opened is not a named need
  //     it can take a dollar for. Minting keeping-ec2 an address of its own
  //     must not become a way around that gate.
  const closed = { ...EPOCH_POT, status: "closed" };
  const answer = fundRead(null, { db: potDb([closed]) });
  const row = potIn(answer, "keeping-ec2");
  assert.equal(row.money_moment, null);
  assert.match(row.why, /cannot take a dollar/);
  assert.equal(/0x[0-9a-fA-F]{40}/.test(JSON.stringify(row)), false,
    "not even its own minted address leaks from a pot that is not open");
});

// ── POS-184 · the `fund` read carries the stakers its own card promises ──────
//
// The card at household-apex.mjs § HOUSEHOLD_READS.fund now says this read
// answers WHO has staked. fundRead FLATTENS the board's escrow block to a bare
// number (`escrow: p.escrow?.staked ?? 0`), so without the field beside it the
// description would promise an answer the door drops on its way out — a door
// lying about itself, which is the drift class this suite keeps catching. Both
// halves are asserted together, because either alone can go stale silently.

// A db that serves the pot files AND the escrow behind them, which potDb above
// deliberately does not — this test's whole subject is the escrow.
const stakedDb = (files, stakers) => ({
  prepare: (sql) => ({
    all: () => (/FROM pots\b/.test(sql) ? files.map((f) => ({ id: f.pot, json: JSON.stringify(f) }))
      : /FROM pot_stakers\b/.test(sql) ? stakers : []),
    get: () => (/FROM pot_escrow\b/.test(sql)
      ? { staked: stakers.reduce((n, s) => n + s.staked, 0) } : undefined),
  }),
});

test("POS-184 — the `fund` read names WHO staked, and its card says so", () => {
  const rows = [{ handle: "keemin", staked: 6 }, { handle: "limen", staked: 2 }];
  const answer = fundRead(null, { db: stakedDb([EPOCH_POT], rows) });
  const pot = potIn(answer, "keeping-ec2");
  assert.deepEqual(pot.stakers, rows, "the read carries them, biggest first, as the board sorted them");
  assert.equal(pot.stakers.reduce((n, s) => n + s.staked, 0), pot.escrow,
    "and the flat `escrow` number it has always carried is exactly their sum");

  // THE CARD. An agent chooses this read from its one-line description and
  // nowhere else, so the field is only discoverable if the line names it.
  assert.match(HOUSEHOLD_READS.fund, /stake/i,
    "the card an agent picks this read from names the stakes as part of the answer");

  // AND THE EMPTY CASE, present rather than absent: "nobody yet" is an answer a
  // resident can act on; a missing field is a door that did not look.
  const bare = potIn(fundRead(null, { db: stakedDb([EPOCH_POT], []) }), "keeping-ec2");
  assert.deepEqual(bare.stakers, [], "an empty list");
  assert.equal(bare.escrow, 0, "beside the zero it sums to");
});
