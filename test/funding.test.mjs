// funding.test.mjs — the funding seam at the door (2026-08-21).
//
// The ledger rows below are the LANDED grammar (tools/stamp-mint.mjs § THE
// FUNDING SEAM, seam/ledger-legs-aligned @ 3668881b), not a paraphrase of it:
// tight `pot:` and `epoch:`, loose `rail: `/`usd: `/`from: `/`ref: `/`for: `,
// whole dollars, a keeping burn that IS the escrow movement, and two arrow-free
// rows (holo to the payers, the keeping mint home to the stakers) that carry no
// arrow precisely so no fold that moves money can ever see them.
//
// The fixture is one coherent epoch close on the town's own pot, in the town's
// canonical close-block order (pot-return, keeping-burn, keeping mint, holo),
// so the numbers mean something: the $150 posted need is fully met, wright's 4
// burns whole at funded_fraction 1, σ=0.5 → 2 minted for keeping home to wright
// HIMSELF (not to the pot's beneficiary), and floor((1−σ)·4 · 100/150) = 1 holo
// to the $100 payer, 0 to the $50 payer — and a row for BOTH, because the close
// writes one per receipt whether it mints anything or not.
//
// THE FOUNDER'S RULING, 2026-08-26. The 2026-08-24 proposal for a second money
// row was ideation and never shipped. holo stays, there is no replacement noun,
// and `pot-receipt` remains the only money row. What the proposed row used to
// carry — the mark that a receipt's ref had been consumed — now rides the holo
// row, which is why its count is `(\d+)` and 0 is lawful.
//
// AMENDED 2026-09-17 — THE FOUNDER'S RULING, verbatim: "non-spendable is
// repealed; the stamps are like any other, but are holo to signify the special
// source." And: "I'm good to let funding minted stamps contribute to the max
// stamps you can get from another fund. it compounds by design." Holo is fresh
// mint to a giver, liquid like any stamp; the word names its source and its ink.
//
// WHAT THAT DOES TO THIS FILE, and it is worth stating because it is not what
// the sweep's brief expected: the office gained NO holo arm, because the office
// holds no balance fold. `balance` / `mint_count` / `staked` come off the
// `stamps` table, which src/hydrate.mjs writes from the TOWN's own foldBalances
// / foldMintCount / foldStaked, imported live from the checkout; both stake
// clips take their balance from the town's ballotState. So the tense numbers
// change by DERIVATION when the town's folds credit holo by kind
// (postmark-town/postmark #2811), and the fixtures below seed the `stamps` table
// the way that amended fold will write it. The one arithmetic the office really
// owned — D1's ownership sum — DID have to change: it added holo to a
// mint_count that now already contains it.
//
// The laws these tests pin:
//   - holo is LIQUID: it is inside minted and liquid, inside assets, and the
//     caption is exact (was: holo is soulbound and never sums into assets)
//   - and it is counted ONCE — the ownership read does not add a holo that is
//     already inside the town's mint_count
//   - a zero-holo household reads a WELL-FORMED empty section, not an absence
//   - a pot's contributor roll carries every holo row on it, joined to the
//     pot-receipt that row's `ref:` names
//   - a keeping burn drains the escrow it burned — a matched stake does not
//     sit in the pot forever looking like support that will come back
//   - a row written in the grammar the office GUESSED before the town landed
//     its own is surfaced invalid by name, never rendered as good
//   - R12's σ leg IS mint, source-tagged, with no liquid coin — so it is inside
//     the ownership read and outside every tense
//   - D1's ownership is a READ, not a fifth tense, and shows its own parts
//   - the reserved `treasury` pot takes direct-to-town receipts only, and they
//     mint nothing — and are still settled, with a holo row of 0
//   - A ZERO-HOLO RECEIPT IS STILL SETTLED. Without that, every grant, treasury
//     dollar, outside payment, ρ-capped household and sole staker would be
//     re-counted and re-minted at every future close

import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA } from "../src/schema.mjs";
import { parseLedgerText, foldFunding, classifyFundingRow, readPots, HOLO_CAPTION, HOLO_EXPANSION, WHAT_THIS_BUYS, TEACH } from "../src/funding.mjs";
import { stampsDetail, potBoard, questBoardFor } from "../src/queries.mjs";
import { NO_TOWN, townClone, townModuleUrl } from "./fixture-paths.mjs";

const SKIP = !townClone() && NO_TOWN;

// ── the landed grammar, one row of every kind ────────────────────────────────

const LEDGER = `# stamp-ledger — fixture

- 2026-08-01 · rules: stamps-v1 · sig: sigA
- 2026-08-02 · pot-receipt · pot:keeping-ec2 · rail: stripe · usd: 100 · from: keemin · ref: ch_1QxTest · sig: sigB
- 2026-08-03 · pot-receipt · pot:keeping-ec2 · rail: usdc · usd: 50 · from: marbinner · ref: 0xdeadbeef · sig: sigC
- 2026-08-04 · wright → stake:pot/keeping-ec2 · 4 · via: api · sig: sigD
- 2026-08-04 · limen → stake:pot/keeping-ec2 · 2 · via: mail:ltr-0912 · sig: sigE
- 2026-08-05 · keemin → stake:pot/keeping-ec2 · 6 · via: api · sig: sigF
- 2026-08-31 · stake:pot/keeping-ec2 → limen · 2 · for: pot-return:2026-08 · sig: sigG
- 2026-08-31 · stake:pot/keeping-ec2 → BURN · 4 · for: keeping:2026-08 · staker: wright · sig: sigH
- 2026-08-31 · minted · wright · 2 · for: keeping:keeping-ec2 · epoch:2026-08 · sig: sigI
- 2026-08-31 · holo · keemin · 1 · pot:keeping-ec2 · epoch:2026-08 · ref: ch_1QxTest · sig: sigJ
- 2026-08-31 · holo · marbinner · 0 · pot:keeping-ec2 · epoch:2026-08 · ref: 0xdeadbeef · sig: sigL
- 2026-08-20 · pot-receipt · pot:treasury · rail: grant · usd: 10000 · from: keemins-dad · ref: grant-2026-08 · sig: sigM
- 2026-08-20 · holo · keemins-dad · 0 · pot:treasury · epoch:2026-08 · ref: grant-2026-08 · sig: sigN
`;

// Rows the office's PRE-LANDING guess would have folded as good. Every one of
// them is now surfaced invalid — the point of pinning to the town's bytes.
const GUESSED = `- 2026-08-21 · holo-mint → mallory · 999 · pot: keeping-ec2 · epoch: 2026-09 · receipt: r1 · sig: sigO
- 2026-08-21 · pot-receipt · pot: keeping-ec2 · rail: stripe · usd: 25 · receipt: ch_guessed · sig: sigP
- 2026-08-21 · keeping-burn · household: mallory · 3 · pot: keeping-ec2 · epoch: 2026-09 · sig: sigQ
- 2026-08-22 · stake:pot/keeping-ec2 → mallory · 1 · for: unstake · sig: sigS
`;

// The RETIRED σ-leg shapes, all three in perfect form for the draft that wrote
// them. The town's own reader returns unknown for each, so the door's job is to
// refuse them BY NAME — a retired row that reads as silence is indistinguishable
// from one the door failed to notice.
//   sigR — draft 1: a real mint, to the pot's BENEFICIARY, spendable.
//   sigR2 — draft 2: right recipient, right arrow-free shape, retired noun (R12
//           retires "keeping-equity" from every surface).
//   sigR3 — the smuggle: R12's own `for: keeping:<pot>` tag wearing a movement
//           arrow. This is the dangerous one — it reads lawful, and its arrow
//           would put it inside the balance AND mint-count folds, handing back
//           liquid coin already paid when the stake burned.
const RETIRED = `- 2026-08-31 · MINT → meepo · 2 · for: keeper-equity:keeping-ec2/2026-08 · sig: sigR
- 2026-08-31 · keeping-equity · wright · 2 · pot:keeping-ec2 · epoch:2026-08 · sig: sigR2
- 2026-08-31 · MINT → wright · 2 · for: keeping:keeping-ec2 · epoch:2026-08 · sig: sigR3
`;

// Complete in every field and wrong in exactly one byte: the loose colon the
// office used to write, on all three ARROW-FREE kinds (receipt, holo, keeping
// mint). These are what keep the tight-colon pin honest — a reason string can
// be asserted without the regex actually holding, so each of these rows is ALSO
// checked for its absence from the folds below.
const LOOSE = `- 2026-08-21 · pot-receipt · pot: keeping-ec2 · rail: stripe · usd: 25 · from: mallory · ref: ch_loose · sig: sigX
- 2026-08-21 · holo · mallory · 7 · pot: keeping-ec2 · epoch: 2026-08 · ref: ch_loose · sig: sigY
- 2026-08-21 · minted · mallory · 3 · for: keeping:keeping-ec2 · epoch: 2026-08 · sig: sigZ
`;

// Malformed under the landed grammar itself.
const FORGED = `- 2026-08-21 · pot-receipt · pot:keeping-ec2 · rail: paypal · usd: 25 · from: mallory · ref: x1 · sig: sigT
- 2026-08-21 · pot-receipt · pot:keeping-ec2 · rail: stripe · usd: 10.5 · from: mallory · ref: x2 · sig: sigU
- 2026-08-21 · mallory → stake:pot/treasury · 5 · via: api · sig: sigV
- 2026-08-21 · holo · mallory · 5 · pot:treasury · epoch:2026-08 · ref: x3 · sig: sigW
`;

const fold = () => foldFunding(parseLedgerText(LEDGER + GUESSED + RETIRED + LOOSE + FORGED));
const reasonFor = (f, needle) => f.invalid.find((i) => i.line.includes(needle))?.reason ?? "";

test("the fold reads every landed row kind: receipts, escrow, burn, holo, and the roll it joins", () => {
  const f = fold();

  const receipts = f.receiptsByPot.get("keeping-ec2") ?? [];
  assert.equal(receipts.reduce((n, r) => n + r.usd, 0), 150);
  assert.deepEqual(receipts.map((r) => r.rail).sort(), ["stripe", "usdc"]);
  assert.deepEqual(receipts.map((r) => r.from).sort(), ["keemin", "marbinner"], "a receipt names its payer — `from:`, the only record of who paid until the close");
  assert.equal(receipts[0].receipt, "ch_1QxTest", "the receipt ref is `ref:`, not `receipt:`");

  // 4 + 2 + 6 staked, 2 returned unmatched, 4 burned as matched → 6 still open
  assert.equal(f.potEscrow.get("keeping-ec2"), 6, "a keeping burn drains the escrow it burned");

  const holo = f.holoByParty.get("keemin") ?? [];
  assert.equal(holo.reduce((n, h) => n + h.holo, 0), 1);
  assert.equal(holo[0].receipt, "ch_1QxTest", "holo rides the receipt that witnessed it");
  assert.equal(f.holoByParty.has("wright"), false, "the keeping mint is not holo — the two legs of one close are different things");

  const keeping = f.keepingByParty.get("wright") ?? [];
  assert.equal(keeping.reduce((n, e) => n + e.n, 0), 2, "the σ leg comes home to the STAKER at par of their own burn");
  assert.deepEqual({ pot: keeping[0].pot, epoch: keeping[0].epoch }, { pot: "keeping-ec2", epoch: "2026-08" });
  assert.equal(f.keepingByParty.has("meepo"), false, "and not to the pot's beneficiary — that was the corrected law");

  // THE JOIN: attribution is the pot-receipt's (`from:`, `usd:`, its date), and
  // the holo row names the receipt it settles. Neither half is duplicated.
  const roll = f.rollByPot.get("keeping-ec2") ?? [];
  assert.equal(roll.length, 2, "a pot with two patrons rolls both of them");
  assert.deepEqual(roll.map((d) => d.patron).sort(), ["keemin", "marbinner"]);
  assert.equal(roll.find((d) => d.patron === "marbinner").holo, 0, "a payment is recorded even when it mints nothing");
  assert.equal(roll.find((d) => d.patron === "marbinner").usd, 50,
    "and the dollars come off the receipt — the only money row there is");
  assert.deepEqual(
    roll.find((d) => d.patron === "keemin"),
    { patron: "keemin", date: "2026-08-02", pot: "keeping-ec2", usd: 100, receipt: "ch_1QxTest", holo: 1 },
    "join holo→receipt on ref and (patron, dollars, date, receipt, holo) all come back");
  assert.deepEqual((f.rollByParty.get("keemin") ?? []).map((x) => x.receipt), ["ch_1QxTest"],
    "the same rows, keyed by payer, for the household's own read");

  const town = f.rollByPot.get("treasury") ?? [];
  assert.equal(town.length, 1, "direct-to-town dollars roll on the reserved pot too");
  assert.equal(town[0].holo, 0);
  assert.equal(town[0].usd, 10000);
});

test("the grammar the office guessed before the town landed its own is now invalid", () => {
  const f = fold();
  // AMENDED 2026-09-17: the REFUSAL is unchanged, the REASON is re-aimed.
  // Soulbound is repealed, so "holo has no verbs" is no longer why this row is
  // bad; a holo ROW is a MINT and not a movement, and an arrow would have the
  // movement folds read it as a transfer while the by-kind credit also minted
  // it — the payer paid twice.
  assert.match(reasonFor(f, "holo-mint → mallory"), /ARROW-FREE/,
    "the movement-shaped holo row is refused by the shape law, not by a typo");
  assert.match(reasonFor(f, "holo-mint → mallory"), /MINT, not a movement/,
    "and it is refused for the reason that SURVIVED the ruling — a mint wearing a movement arrow pays twice");
  assert.doesNotMatch(reasonFor(f, "holo-mint → mallory"), /has no verbs/,
    "the repealed reason must not be the one a resident is told");
  assert.match(reasonFor(f, "ch_guessed"), /NO space after the colon/,
    "`pot: x` (loose) is not `pot:x` (tight) — the receipt names no readable pot");
  assert.match(reasonFor(f, "· keeping-burn ·"), /no standalone keeping-burn row/,
    "the burn is the escrow movement to BURN, not a row of its own");
  // AMENDED 2026-09-17: `for: unstake` is a lawful exit now (the town's
  // pot-unstake row), but only with its `via:` — the fixture's row has none,
  // so it stays invalid, refused for the field it lacks rather than for the
  // word it uses.
  assert.match(reasonFor(f, "for: unstake"), /carries no `via:`/,
    "a stake taken back must name how it was taken; a bare `for: unstake` is refused for the missing field");

  // and none of them bought their way into the folds
  assert.equal(f.holoByParty.has("mallory"), false, "a forged holo mints nothing");
  assert.equal((f.rollByPot.get("keeping-ec2") ?? []).some((d) => d.patron === "mallory"), false);
  assert.equal(f.potEscrow.get("keeping-ec2"), 6, "the malformed unstake moved no escrow");
});

test("all three retired σ-leg shapes are refused BY NAME, never read as lawful mint", () => {
  // LAW R12 (Keemin, 2026-08-21 afternoon): "the σ leg IS ORDINARY MINT,
  //          source-tagged (`minted · for: keeping:<pot>`), with NO liquid coin
  //          (the coin was paid when the stake burned; the row stays
  //          purpose-tagged so balance folds never hand liquid back)."
  // Refusing silently would be indistinguishable from failing to notice.
  const f = fold();

  // draft 1 — the beneficiary's spendable mint
  const one = reasonFor(f, "for: keeper-equity:");
  assert.match(one, /RETIRED/, "the row is named as retired, not merely unparsed");
  assert.match(one, /goes home to the stakers/, "and the reason says where the σ leg actually goes now");

  // draft 2 — the retired NOUN
  const two = reasonFor(f, "· keeping-equity · wright");
  assert.match(two, /RETIRED/);
  assert.match(two, /minted · <staker>/, "the reason hands back the ruled shape");

  // the smuggle — R12's tag with an arrow on it
  const three = reasonFor(f, "MINT → wright · 2 · for: keeping:");
  assert.match(three, /never carry a movement arrow/, "the arrow is named as the fault");
  assert.match(three, /NO liquid coin/, "and the reason quotes the law it breaks");

  assert.equal(f.keepingByParty.has("meepo"), false, "the beneficiary earns nothing from any of them");
  assert.equal(f.holoByParty.has("meepo"), false);
  assert.equal((f.keepingByParty.get("wright") ?? []).reduce((n, r) => n + r.n, 0), 2,
    "and wright still holds exactly the ONE lawful row's 2 — no retired shape added to it");
});

test("the σ leg reads in R12's own vocabulary, and the arrow is the enforcement", () => {
  // LAW R12: "source-tagged (`minted · for: keeping:<pot>`) ... with NO liquid
  //          coin ... the row stays purpose-tagged so balance folds never hand
  //          liquid back."
  const keeping = classifyFundingRow("- 2026-08-31 · minted · wright · 2 · for: keeping:keeping-ec2 · epoch:2026-08");
  assert.equal(keeping.kind, "keeping-mint");
  assert.equal(keeping.handle, "wright", "the σ leg's subject is the staker who earned it");
  assert.equal(keeping.pot, "keeping-ec2", "and the source tag names the pot it was earned keeping");
  assert.equal(keeping.n, 2);

  const f = fold();
  assert.equal(f.invalid.some((i) => i.line.includes("· minted · wright")), false, "a lawful σ row is not called forged");
  assert.equal((f.rollByParty.get("wright") ?? []).length, 0, "a keeping mint is not a funding act — it rolls for nobody");

  // the arrow is the enforcement, exactly as it is for holo
  const moved = classifyFundingRow("- 2026-08-31 · minted → wright · 2 · for: keeping:keeping-ec2 · epoch:2026-08");
  assert.equal(moved.kind, "invalid");
  assert.match(moved.reason, /never carry a movement arrow|ARROW-FREE/,
    "a σ row that moves is refused by the law that gives it no liquid coin");
});

test("a row that is complete but writes the loose colon is refused by the fold, not just by the message", () => {
  const f = fold();
  // Asserting the REASON alone would pass even if the regex quietly loosened —
  // the diagnoser is a separate code path. So this pins the numbers instead:
  // if `pot: ` ever parsed, ch_loose would add $25 to the receipts, a third row
  // to the roll, and 7 holo to a household that paid for none of it; if
  // `epoch: ` ever parsed, mallory would hold 3 minted for keeping she never
  // staked for.
  assert.equal((f.receiptsByPot.get("keeping-ec2") ?? []).reduce((n, r) => n + r.usd, 0), 150,
    "the loose-colon receipt adds no dollars");
  assert.equal((f.receiptsByPot.get("keeping-ec2") ?? []).some((r) => r.receipt === "ch_loose"), false);
  assert.equal((f.rollByPot.get("keeping-ec2") ?? []).length, 2, "the loose-colon holo is not on the roll");
  assert.equal(f.holoByParty.has("mallory"), false, "the loose-colon holo mints nothing");
  assert.equal(f.keepingByParty.has("mallory"), false, "and the loose-colon keeping mint mints nothing either");
  // all three are named, so the refusal is disclosed rather than silent
  assert.equal(f.invalid.filter((i) => i.line.includes("ch_loose")).length, 2);
  assert.match(reasonFor(f, "minted · mallory · 3"), /NO space after the colon/,
    "the third arrow-free kind is held to the same tight colon");
});

test("rows malformed under the landed grammar are surfaced by name", () => {
  const f = fold();
  assert.match(reasonFor(f, "paypal"), /stripe\|usdc\|grant/, "the paypal rail is refused by name");
  assert.match(reasonFor(f, "10.5"), /WHOLE number/, "fractional dollars are not a smaller payment, they are not a row");
  assert.match(reasonFor(f, "stake:pot/treasury"), /takes direct-to-town receipts, never stakes/);
  assert.match(reasonFor(f, "holo · mallory · 5 · pot:treasury"), /mint no holo/,
    "a treasury holo row that claims a mint is refused — nothing burned, so nothing minted");
  assert.equal((f.rollByPot.get("treasury") ?? []).some((x) => x.patron === "mallory"), false,
    "and the refused row rolls nothing");
  assert.equal(f.potEscrow.has("treasury"), false, "the refused treasury stake escrows nothing");
});

// ── THE ZERO-HOLO RECEIPT (the founder's ruling, 2026-08-26) ────────────────
//
// This is the regression the whole change turns on, so it is written to be able
// to FAIL: the same fold runs twice, once on a ledger that settles the $50
// receipt with a holo row of 0 and once on a ledger missing that one row, and
// the two answers must differ. If they ever agree, the zero-holo row has
// stopped being the mark of a settled payment and every future close will count
// that $50 again.
//
// The rows that mint 0 are not a corner: a grant, a treasury dollar, an outside
// payer, a ρ-capped household and a sole staker all land here.
const WITHOUT_THE_ZERO_ROW = LEDGER.replace(
  "- 2026-08-31 · holo · marbinner · 0 · pot:keeping-ec2 · epoch:2026-08 · ref: 0xdeadbeef · sig: sigL\n", "");

test("a receipt that minted ZERO holo is still settled — and a second close cannot count it again", () => {
  // 1 · a holo row of 0 is a lawful row. `([1-9]\d*)` would have refused it.
  const zero = classifyFundingRow("- 2026-08-31 · holo · marbinner · 0 · pot:keeping-ec2 · epoch:2026-08 · ref: 0xdeadbeef");
  assert.equal(zero.kind, "holo", "0 is a real answer, not a malformed row");
  assert.equal(zero.n, 0);
  assert.equal(zero.ref, "0xdeadbeef", "and it names the receipt it settles");

  // 2 · so the $50 receipt is on the roll, at holo 0, with its dollars intact
  const f = foldFunding(parseLedgerText(LEDGER));
  const settled = new Set((f.rollByPot.get("keeping-ec2") ?? []).map((x) => x.receipt));
  assert.equal(settled.has("0xdeadbeef"), true, "the zero-holo row is what marks the payment counted");
  assert.equal(settled.has("ch_1QxTest"), true);

  // 3 · and the pot's OPEN dollars are 0 — nothing is left for a next close to
  //     take, which is the whole point
  const pot = potBoard(fundingDb()).list[0];
  assert.equal(pot.funding.dollars_open, 0, "a settled epoch's dollars do not fund the next one");

  // 4 · THE FLIP. Delete that one row and the same $50 comes back as open
  //     money — re-counted, and re-mintable, forever.
  const g = foldFunding(parseLedgerText(WITHOUT_THE_ZERO_ROW));
  const gSettled = new Set((g.rollByPot.get("keeping-ec2") ?? []).map((x) => x.receipt));
  assert.equal(gSettled.has("0xdeadbeef"), false, "with no holo row, nothing says the payment was counted");
  const openDollars = (g.receiptsByPot.get("keeping-ec2") ?? [])
    .filter((r) => !gSettled.has(r.receipt)).reduce((n, r) => n + r.usd, 0);
  assert.equal(openDollars, 50, "and $50 of already-settled money reads as unfunded need again");
  assert.notEqual(openDollars, 0, "the probe can fail — this is the bug the zero row prevents");

  // 5 · the treasury receipt is the same case: it mints nothing by law, and it
  //     is settled by a row of 0 exactly like any other payment
  assert.deepEqual((f.rollByPot.get("treasury") ?? []).map((x) => [x.receipt, x.holo]),
    [["grant-2026-08", 0]], "direct-to-town dollars mint nothing and are still marked counted");
});

test("rows of the existing grammar pass through untouched (not funding, not invalid)", () => {
  assert.equal(classifyFundingRow("- 2026-08-21 · rules: stamps-v1"), null);
  assert.equal(classifyFundingRow("- 2026-07-17 · MINT → wright · 1 · for: some-letter (sent)"), null);
  assert.equal(classifyFundingRow("- 2026-07-19 · lysander → stake:illuminator-name/Aurelia · 10 · via: api"), null);
  assert.equal(classifyFundingRow("- 2026-08-01 · limen → stake:world-mark/keemin/thebench · 3 · via: api"), null);
  assert.equal(classifyFundingRow("- 2026-08-01 · wright → limen · 5 · id: ltr-0912"), null);
});

// ── pot files (the bounty files on the quest board) ──────────────────────────

// The town's own pot file, field for field (WHITE_PAGES/pot-keeping-ec2.json).
const POT_FILE = {
  pot: "keeping-ec2",
  subtype: "bounty",
  status: "draft",
  title: "Keep the lights on — the town box",
  target_usd_per_epoch: 150,
  epoch_cadence: "monthly",
  beneficiary: null,
  received_usd: 0,
  board: "quest-registry.json § keeping-ec2",
};

function tempTown() {
  const dir = mkdtempSync(join(tmpdir(), "postmark-funding-test-"));
  mkdirSync(join(dir, "WHITE_PAGES"), { recursive: true });
  writeFileSync(join(dir, "WHITE_PAGES", "pot-keeping-ec2.json"), JSON.stringify(POT_FILE));
  writeFileSync(join(dir, "WHITE_PAGES", "pot-broken.json"), JSON.stringify({
    pot: "broken", target_usd_per_epoch: 10, epoch_cadence: "monthly", // status / received_usd / beneficiary missing
  }));
  // complete, but posts a fractional need — the town's close refuses it, so the
  // door must not render a funded fraction against a target nothing can close
  writeFileSync(join(dir, "WHITE_PAGES", "pot-fractional.json"), JSON.stringify({
    ...POT_FILE, pot: "fractional", target_usd_per_epoch: 150.5,
  }));
  return dir;
}

test("readPots reads the town's real pot file and surfaces the malformed one", () => {
  const { pots, invalid } = readPots(tempTown());
  assert.equal(pots.length, 1);
  assert.equal(pots[0].id, "keeping-ec2");
  assert.equal(pots[0].data.status, "draft");
  assert.equal(pots[0].data.beneficiary, null, "a draft pot names no keeper yet — present-and-null is lawful");
  assert.equal(invalid.length, 2);
  assert.match(invalid.find((i) => i.line.includes("broken")).reason, /missing status, received_usd, beneficiary/);
  assert.match(invalid.find((i) => i.line.includes("fractional")).reason, /positive whole number of dollars/,
    "the posted need is what dollars are priced against; a fractional one cannot close");
});

// ── the door reads (what an agent sees from their seat) ──────────────────────

function fundingDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  // THE `stamps` TABLE IS THE TOWN'S FOLD, MATERIALIZED — src/hydrate.mjs
  // § Stamps writes it from the town's own foldBalances / foldMintCount /
  // foldStaked. So these rows are seeded as that AMENDED fold will write them
  // (postmark-town/postmark #2811): a holo row of n is credited to the payer by
  // kind, so it is already inside both `mint_count` and `balance` here. That is
  // the whole reason no office fold gained a holo arm on 2026-09-17 — adding one
  // would count the same n twice.
  //
  // keemin: 10 primary mint + 1 holo = 11 ever minted, 6 staked → 5 liquid,
  // assets 11. (Before the ruling: 10 minted, 4 liquid, assets 10, holo apart.)
  db.prepare("INSERT INTO stamps (handle, balance, mint_count, staked) VALUES (?,?,?,?)").run("keemin", 5, 11, 6);
  db.prepare("INSERT INTO stamps (handle, balance, mint_count, staked) VALUES (?,?,?,?)").run("limen", 3, 3, 0);
  // wright: the staker whose 4 burned — 2 minted for keeping came home, and none
  // of it may show up in any of his four tense numbers
  db.prepare("INSERT INTO stamps (handle, balance, mint_count, staked) VALUES (?,?,?,?)").run("wright", 5, 9, 0);
  const f = foldFunding(parseLedgerText(LEDGER + GUESSED + RETIRED + LOOSE + FORGED));
  // hydrate's inserts, in miniature — keyed by handle here (no household
  // registry in a fixture; the read answers to slug AND handle)
  const insHolo = db.prepare("INSERT INTO funding_holo (party, pot, holo, epoch, date, receipt) VALUES (?,?,?,?,?,?)");
  for (const [party, ms] of f.holoByParty) for (const m of ms) insHolo.run(party, m.pot, m.holo, m.epoch, m.date, m.receipt);
  const insKeep = db.prepare("INSERT INTO funding_keeping_mint (party, pot, n, epoch, date) VALUES (?,?,?,?,?)");
  for (const [party, rs] of f.keepingByParty) for (const r of rs) insKeep.run(party, r.pot, r.n, r.epoch, r.date);
  const insRoll = db.prepare("INSERT INTO funding_roll (patron, pot, usd, date, receipt, holo) VALUES (?,?,?,?,?,?)");
  for (const [pot, rs] of f.rollByPot) for (const r of rs) insRoll.run(r.patron, pot, r.usd, r.date, r.receipt, r.holo);
  const insRcpt = db.prepare("INSERT INTO pot_receipts (pot, rail, usd, date, receipt, payer) VALUES (?,?,?,?,?,?)");
  for (const [pot, rs] of f.receiptsByPot) for (const r of rs) insRcpt.run(pot, r.rail, r.usd, r.date, r.receipt, r.from);
  for (const [pot, n] of f.potEscrow) db.prepare("INSERT INTO pot_escrow (pot, staked) VALUES (?,?)").run(pot, n);
  const insStaker = db.prepare("INSERT INTO pot_stakers (pot, handle, staked) VALUES (?,?,?)");
  for (const [handle, mine] of f.potEscrowByHandle) for (const [pot, n] of mine) if (n > 0) insStaker.run(pot, handle, n);
  for (const iv of f.invalid) db.prepare("INSERT INTO funding_invalid (row_kind, line, reason) VALUES (?,?,?)").run(iv.row_kind, iv.line, iv.reason);
  db.prepare("INSERT INTO pots (id, json) VALUES (?,?)").run("keeping-ec2", JSON.stringify(POT_FILE));
  return db;
}

test("a household with holo reads four tenses that sum sanely — and holo is IN the balance, once", () => {
  // AMENDED 2026-09-17 — the founder: "non-spendable is repealed; the stamps are
  // like any other, but are holo to signify the special source." This test used
  // to assert `assets === 10` under the words "holo is NOT in assets — soulbound
  // means outside the arithmetic". It now asserts the opposite, out loud.
  const d = stampsDetail(fundingDb(), "keemin");
  assert.deepEqual(
    { minted: d.tenses.minted, liquid: d.tenses.liquid, staked: d.tenses.staked, holo: d.tenses.holo },
    { minted: 11, liquid: 5, staked: 6, holo: 1 },
    "10 primary + 1 holo minted; the holo stamp is spendable, so it is in liquid too",
  );
  assert.equal(d.liquid + d.staked, d.assets, "stamp arithmetic: liquid + staked = assets");
  assert.equal(d.assets, 11, "holo IS in assets now — it is a stamp like any other");
  assert.equal(d.tenses.minted - d.tenses.holo, 10,
    "and holo is a SUBSET of minted, not a pile beside it — take it out and the primary mint is what is left");
  assert.equal(d.stamps, d.liquid, "the back-compat alias survives the seam");
  assert.equal(d.holo.caption, "a record of contribution, not a promise of profit", "the caption is law, byte for byte");
  assert.equal(d.holo.caption, HOLO_CAPTION);
  assert.equal(d.holo.total, 1);
  // The funding act rides the holo row itself — which pot, when, how many
  // dollars, the receipt that witnessed them, and the holo minted for it. There
  // is no second register beside it (the founder's 2026-08-26 ruling).
  assert.equal(d.holo.mints.length, 1);
  assert.deepEqual(d.holo.mints[0],
    { pot: "keeping-ec2", holo: 1, dollars: 100, epoch: "2026-08", date: "2026-08-31", receipt: "ch_1QxTest" });
  // THE WHOLE SHAPE, pinned. The 2026-08-24 proposal for a second register
  // beside `holo` was ideation and never shipped; the founder ruled on
  // 2026-08-26 that holo stays and there is no replacement noun. Listing the
  // keys is how this test notices a second register growing back under ANY
  // name, which asserting one key's absence could not.
  assert.deepEqual(Object.keys(d).sort(),
    ["assets", "holo", "keeping_mint", "liquid", "mint_count", "moved", "ownership", "staked", "stamps", "tenses"],
    "one register for the funding facts, not two");
  assert.match(d.moved, /holo\.mints/, "and the read says where those facts live instead of changing shape in silence");
  assert.ok(d.tenses.teach && d.holo.teach, "every new section teaches at the point of contact");
  // AMENDED 2026-09-14 (ECONOMY-DIALS.json law_side.keeping): nothing burns.
  // This used to assert /BURNS/ — that the staked tense said a matched keeping
  // stake burns rather than returns. It now asserts the opposite, out loud.
  assert.match(d.tenses.teach, /nothing burns/, "the staked tense says out loud that a keeping stake comes home whole — nothing burns");
  assert.doesNotMatch(d.tenses.teach, /BURNS/, "the repealed sentence must not be taught");
  // AMENDED 2026-09-17: and the same discipline for the sentence THIS ruling
  // repealed. The tenses caption said holo was "a record, never a balance" and
  // "outside that arithmetic"; the holo caption said it "cannot be spent,
  // staked, transferred, or redeemed". A door that still teaches that is
  // telling a giver their stamps do not work.
  assert.doesNotMatch(d.tenses.teach, /soulbound|never a balance|outside that arithmetic/,
    "the repealed soulbound sentence must not be taught on the tenses");
  assert.doesNotMatch(d.holo.teach, /soulbound|cannot be spent|never spent as postage|no door will ever count it as balance/,
    "nor on the holo section");
  assert.match(d.holo.teach, /liquid like any stamp/,
    "and the holo section carries the ruling's own one-line rule");
  assert.match(d.tenses.teach, /a subset of minted and of liquid, never a pile beside them/,
    "the tenses say where holo now lives: inside minted and inside liquid, not beside them");
});

test("THE MONEY MOMENT says holo votes, and names the cap in the same breath", () => {
  // THE FOUNDER, 2026-09-17, verbatim: "holo does anything a normal stamp can;
  //   staking vs voting is a nondistiction."
  // THE SENTENCE THIS REPEALS, which was live on this door until today: "this
  //   buys ownership and memory, NEVER VOICE, and converts to real value only
  //   if the town someday does."
  //
  // This is the one place the office made a promise about VOICE, and it made it
  // at the instant a patron is about to send money. A test that only compared
  // the door's field to the constant would go green on any wording at all, so
  // this reads the CLAIM.
  assert.doesNotMatch(WHAT_THIS_BUYS, /never voice|no voice|not voice|never standing/i,
    "the repealed promise must not be made at the money moment");
  assert.match(WHAT_THIS_BUYS, /including vote/,
    "it says the stamps vote, because they do — a vote is a stake and clips against a fungible balance");
  assert.match(WHAT_THIS_BUYS, /capped/,
    "AND it names the bound in the same breath: a patron told their stamps vote and NOT told their share is capped has been told half the truth");
  assert.match(WHAT_THIS_BUYS, /ownership and memory/,
    "the two things that did not change are still promised");
  assert.match(WHAT_THIS_BUYS, /converts to real value only if the town someday does/,
    "and so is the conversion caveat, which this ruling never touched");
});

test("minted · for keeping reads as its own section — no liquid coin, and no fifth tense", () => {
  // LAW R12: "with NO liquid coin (the coin was paid when the stake burned; the
  //          row stays purpose-tagged so balance folds never hand liquid back)."
  // LAW D1:  "ownership is a derived READ = minted (all sources) + holo — NOT a
  //          tense; no fifth tense node."
  const d = stampsDetail(fundingDb(), "wright");
  assert.equal(d.keeping_mint.total, 2, "the σ leg is SHOWN, not swallowed");
  assert.deepEqual(d.keeping_mint.rows[0], { pot: "keeping-ec2", minted: 2, epoch: "2026-08", date: "2026-08-31" });
  assert.ok(d.keeping_mint.teach, "it teaches at the point of contact like every other new field");

  // no liquid coin: not in liquid, not in staked, not in assets, and not in the
  // earned `minted` the tense arithmetic reconciles against
  assert.deepEqual(
    { minted: d.tenses.minted, liquid: d.tenses.liquid, staked: d.tenses.staked, holo: d.tenses.holo },
    { minted: 9, liquid: 5, staked: 0, holo: 0 },
  );
  assert.equal(d.assets, 5, "the keeping mint is not in assets");
  assert.equal(d.liquid + d.staked, d.assets, "and the tense arithmetic still closes");
  // D1: no fifth tense node. The number is named beside the tenses so nothing is
  // hidden, but `minted` is not widened and no new tense appears.
  assert.equal(d.tenses.minted_keeping, 2, "named beside the tenses, not folded into one");
  assert.equal(d.tenses.minted, 9, "`minted` stays the EARNED number — widening it would break liquid = minted − staked");
  assert.equal(Object.keys(d.tenses).includes("keeping_mint"), false, "and it is NOT a fifth tense");
  assert.equal(d.keeping_mint.counted_in, "ownership", "it is counted — deliberately, in the ownership read");
});

test("THE DOUBLE-COUNT FALSIFIER: ownership counts holo ONCE, because the town's mint fold already did", () => {
  // THE FOUNDER, 2026-09-17: "non-spendable is repealed; the stamps are like any
  // other, but are holo to signify the special source." And: "funding minted
  // stamps contribute to the max stamps you can get from another fund. it
  // compounds by design."
  //
  // This is the one arithmetic the office really owned, and the ruling broke it.
  // D1 (2026-08-21) defined ownership as "minted (all sources) + holo" — correct
  // while holo sat OUTSIDE the mint count. It does not sit outside any more: the
  // `stamps` table is the TOWN's foldMintCount, which credits a holo row by
  // kind, so `mint_count` already contains it and the old sum added it twice.
  //
  // HOW TO FLIP THIS RED (it was flipped before it was trusted): restore
  // `total: mint_count + keeping_total + holo` in src/queries.mjs § stampsDetail
  // and keemin reads 12 against a true 11 — a giver's own gift counted twice on
  // their own page.
  const db = fundingDb();
  const k0 = stampsDetail(db, "keemin");
  assert.equal(k0.tenses.minted, 11, "the town's fold put the holo inside minted");
  assert.equal(k0.holo.total, 1, "and the holo readout still says how much of it came from giving");
  assert.equal(k0.ownership.total, 11,
    "ownership is that number, ONCE — 12 here is the gift counted twice");
  assert.equal(k0.ownership.total, k0.tenses.minted + k0.ownership.minted_keeping,
    "ownership = minted (holo inside it) + the keeping leg, and nothing else");
  assert.notEqual(k0.ownership.total, k0.tenses.minted + k0.ownership.minted_keeping + k0.holo.total,
    "the pre-ruling sum is now a double-count and must not be what this read returns");
  // AND HOLO IS SPENDABLE, so ownership is no longer strictly above assets: for
  // a household with no keeping leg and nothing staked they are the same number.
  // The old assertion `ownership.total !== assets` held only because holo was
  // fenced out of the balance; it is kept here re-aimed at the reason that
  // survives — staked stamps are not spendable.
  assert.equal(k0.assets, 11, "assets carry the holo stamp too");
  assert.equal(k0.ownership.total, k0.assets,
    "with no keeping leg, ownership and assets agree — holo is in both, staked is in both, nothing is fenced");
  assert.equal(k0.liquid, 5, "and liquid is what is actually free to spend: minted 11 − staked 6");
  assert.ok(k0.liquid < k0.assets, "ownership is still not a spendable number — a staked stamp is not free");
});

test("D1: ownership is a derived READ — minted (all sources), holo inside it, with its parts shown", () => {
  // LAW D1 (Keemin, 2026-08-21): "ownership is a derived READ = minted (all
  //         sources) + holo — NOT a tense; no fifth tense node." The "+ holo"
  //         half is AMENDED 2026-09-17 (see the falsifier above); the rest of
  //         D1 — a READ, not a tense, with its parts shown — stands.
  // LAW R12: the σ leg "COUNTS toward the ρ base" and IS mint — so it is inside
  //          "minted (all sources)", which is the whole reason this block exists.
  const db = fundingDb();

  // wright staked and kept: 9 earned + 2 minted for keeping, no holo
  const w = stampsDetail(db, "wright");
  assert.equal(w.ownership.minted_earned, 9);
  assert.equal(w.ownership.minted_keeping, 2);
  assert.equal(w.ownership.minted, 11, "minted = all sources");
  assert.equal(w.ownership.holo, 0);
  assert.equal(w.ownership.total, 11, "ownership = minted (all sources) + the keeping leg");
  assert.notEqual(w.ownership.total, 9, "leaving the keeping leg out would under-read what wright owns");

  // keemin paid: 10 primary + 1 holo = 11 minted (the town's fold), no keeping.
  // ⚠ `minted_earned` IS `mint_count`, and since 2026-09-17 that number carries
  // holo — so the field's NAME now over-promises. Fixing the name is a RENAME on
  // a live door's answer, which this lane may not do; it is reported up on
  // postmark-town/postmark#2885 instead. The value is right and is checked here
  // against what it actually holds, so a future rename starts from a true test.
  const k = stampsDetail(db, "keemin");
  assert.equal(k.ownership.minted_earned, 11,
    "the town's mint_count, holo inside it — the `_earned` in the name is the drift this ruling created");
  assert.equal(k.ownership.minted, 11);
  assert.equal(k.ownership.minted_keeping, 0);
  assert.equal(k.ownership.holo, 1, "and holo says how much of the 11 came from giving");
  assert.equal(k.ownership.total, 11, "11 minted, holo counted once inside it");

  // and the promise on it is the same one holo carries everywhere
  assert.equal(k.ownership.caption, HOLO_CAPTION, "a record of contribution, not a promise of profit");
  assert.ok(k.ownership.teach);
  assert.equal(Object.keys(k.tenses).includes("ownership"), false, "ownership is a read beside the tenses, never one of them");
});

test("a household with zero holo reads a well-formed empty section, not an absence", () => {
  const d = stampsDetail(fundingDb(), "limen");
  assert.equal(d.holo.total, 0);
  assert.deepEqual(d.holo.mints, []);
  assert.equal(d.holo.caption, HOLO_CAPTION, "the caption stands even at zero");
  assert.equal(d.stamps, 3, "the old numbers are untouched");
});

// ── THE RULING'S OWN ESTATE FALSIFIER (the sweep brief, 2026-09-17) ──────────
//
// "an estate with primary 10, holo 3, staked 4 reads `minted 13 · liquid 9 ·
// holo 3`". Seeded the way the town's amended folds write the `stamps` table —
// a holo row of n credited to the payer by kind, so it is inside mint_count and
// inside balance before this read ever sees it.
//
// ⚠ WHAT THIS PROVES AND WHAT IT DOES NOT. It proves the office does not fence
// holo out and does not add it twice. It CANNOT prove the credit itself: the
// fold that does the crediting is the town's (tools/stamp-mint.mjs, imported
// live by src/hydrate.mjs), and this repo has no copy of it to flip. The
// office-side flip that DOES red is the double-count one, above.
test("THE ESTATE FALSIFIER: primary 10 + holo 3, staked 4 reads minted 13 · liquid 9 · holo 3", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  // 10 primary + 3 holo = 13 minted; 4 staked, so 9 free to spend
  db.prepare("INSERT INTO stamps (handle, balance, mint_count, staked) VALUES (?,?,?,?)").run("giver", 9, 13, 4);
  const insHolo = db.prepare("INSERT INTO funding_holo (party, pot, holo, epoch, date, receipt) VALUES (?,?,?,?,?,?)");
  insHolo.run("giver", "keeping-ec2", 2, "2026-09", "2026-09-30", "ch_one");
  insHolo.run("giver", "keeping-ec2", 1, "2026-09", "2026-09-30", "ch_two");

  const d = stampsDetail(db, "giver");
  assert.deepEqual(
    { minted: d.tenses.minted, liquid: d.tenses.liquid, staked: d.tenses.staked, holo: d.tenses.holo },
    { minted: 13, liquid: 9, staked: 4, holo: 3 },
    "the brief's own numbers, off the office's own read",
  );
  assert.equal(d.assets, 13, "liquid + staked — the holo stamps are in there");
  assert.equal(d.ownership.total, 13, "and ownership is the same 13, not 16: holo counted once");
  assert.equal(d.tenses.minted - d.tenses.holo, 10, "primary mint is what is left when the gift is taken out");
});

// THE CLIP, AND AN HONEST NOTE ABOUT WHAT IT MEASURES. The brief asked for "a
// stake of 12 by that household is admitted by the office's clip (it was 10
// before) — quote the door's clip line". The line is src/pot-stake-exec.mjs
// § clipPotStake:
//
//     const balance = state.balances.get(handle) ?? 0;
//     const applied = Math.min(n, balance);
//
// and `state` is the TOWN's ballotState, whose `balances` is the town's
// foldBalances (tools/ballot.mjs L53). So the office's clip admits 12 for the
// same reason its estate read says 13: the town's fold credited the holo. This
// test pins that the clip reads the balance it is handed and clips to nothing
// else — it is NOT a proof of the holo credit, and saying so is the point.
test("the clip admits a stake the holo made affordable — it clips to the town's balance and to nothing else", async () => {
  const { clipPotStake } = await import("../src/pot-stake-exec.mjs");
  const pots = [{ id: "keeping-ec2", data: { ...POT_FILE, status: "open" } }];
  const state = { balances: new Map([["giver", 13]]), lawAt: () => ({ meeps: new Set() }) };
  const r = clipPotStake({ state, pots, handle: "giver", pot: "keeping-ec2", n: 12, date: "2026-10-01" });
  assert.equal(r.applied, 12, "12 of 13 — with the pre-ruling 10 this would have clipped to 10");
  assert.equal(r.clipped, false);
  assert.equal(r.balance_before, 13);
  assert.equal(r.balance_after, 1);
  // the same door on the pre-ruling balance, so the number above is a change and
  // not a coincidence
  const before = clipPotStake({
    state: { balances: new Map([["giver", 10]]), lawAt: () => ({ meeps: new Set() }) },
    pots, handle: "giver", pot: "keeping-ec2", n: 12, date: "2026-10-01",
  });
  assert.equal(before.applied, 10, "and it clipped, which is what a giver used to be told");
  assert.equal(before.clipped, true);
});

test("the pot board carries the landed pot file's own fields, the roll, and the escrow", () => {
  const b = potBoard(fundingDb());
  assert.equal(b.list.length, 1, "the reserved treasury pot has receipts but no file — it is not a board row");
  const pot = b.list[0];
  assert.equal(pot.target_usd_per_epoch, 150, "the target is per epoch, not a lifetime total");
  assert.equal(pot.epoch_cadence, "monthly", "a cadence, not an epoch id — the door does not rename one into the other");
  assert.equal(pot.status, "draft");
  assert.equal(pot.beneficiary, null, "a draft pot shows no keeper rather than inventing one");
  assert.equal(pot.received_usd, 0);
  assert.equal(pot.receipts.sum_usd, 150, "the receipts' own sum is disclosed beside the file's received — two clocks, both shown");
  // both receipts are SETTLED (the epoch closed — each has a holo row naming its
  // ref, the $50 one at holo 0), so the OPEN epoch is unfunded; summing every
  // receipt ever would report this pot fully funded on the strength of a month
  // that already closed
  assert.equal(pot.funding.target_usd_per_epoch, 150);
  assert.equal(pot.funding.dollars_open, 0);
  assert.equal(pot.funding.funded_fraction, 0, "a closed epoch's dollars do not fund the next one");
  assert.ok(pot.funding.teach);
  assert.notEqual(pot.received_usd, pot.receipts.sum_usd, "and the fixture is one where they disagree, so the disclosure is doing work");
  assert.deepEqual(pot.receipts.list.map((r) => r.payer).sort(), ["keemin", "marbinner"]);
  assert.equal(pot.patrons.roll.length, 2);
  assert.deepEqual(pot.patrons.roll.map((r) => r.patron).sort(), ["keemin", "marbinner"]);
  assert.equal(pot.escrow.staked, 6);
  // AMENDED 2026-09-14: the escrow teaches that every stake comes home whole
  // and that the funded share of the mass sizes the givers' mint — the reward
  // half of the story, told without a burn.
  assert.match(pot.escrow.teach, /comes home whole/, "the escrow teaches that a stake comes home whole");
  assert.match(pot.escrow.teach, /minted fresh to the givers/, "and that the funded share of the mass sizes the givers' mint — support that returns is only half the story");
  assert.doesNotMatch(pot.escrow.teach, /BURNS/, "the repealed sentence must not be taught");
  // AMENDED 2026-09-17. The escrow teach is the pot board's own account of what a
  // close does, and the ruling changed two things in it: the mint's SHAPE (the
  // givers' reward IS the holo row, one per receipt settled — there is no
  // `for: funding:` row and never was one) and the cap's BASE (the founder:
  // "funding minted stamps contribute to the max stamps you can get from another
  // fund. it compounds by design"). Both are asserted, because a teach line with
  // no reader is the drift class this lane has found three times today.
  assert.match(pot.escrow.teach, /HOLO ROWS, one per receipt the close settles, 0 included/,
    "the escrow names the row the close actually writes, zeros included — the mark that a receipt is settled");
  assert.match(pot.escrow.teach, /rho-capped against their mint from every source/,
    "and the cap's base, which the ruling widened; 'rho-capped' alone hid which base");
  assert.match(pot.escrow.teach, /compounds by design/, "in the founder's own words");
  assert.ok(b.invalid_rows.list.length >= 9, "every forged and guessed-grammar row is surfaced on the community read");
  assert.ok(pot.teach && pot.patrons.teach && pot.escrow.teach && pot.receipts.teach && b.invalid_rows.teach);
});

// The town's own registry row for the pot (quest-registry.json § keeping-ec2).
const BOUNTY_ROW = {
  id: "keeping-ec2", title: "Keep the lights on (the town box)", subtype: "bounty",
  cadence: "ongoing", validation: "needs-review", status: "draft", target: 150,
  // ⚠ RE-TRANSCRIBED 2026-09-17, and it was stale on TWO counts, only one of
  // them this ruling's. It said "minted back to the stakers, source-tagged for
  // keeping; soulbound holo to the payers" — but the town's own row was
  // rewritten by the 2026-09-14 amendment (nothing burns; there is no keeping
  // mint) and nothing here noticed, because nothing in the office READS this
  // string for meaning: it is fed through questBoardFor only to prove a bounty
  // comes off the card deck. A transcription with no reader drifts silently.
  // Below is the town's live row at postmark-town/postmark@9468d6e34
  // (quest-registry.json § keeping-ec2) with the rho spelled out, which is the
  // one thing a JSON fixture cannot carry verbatim.
  reward: "every stake comes home whole at the close; the share of the staked mass the month's dollars funded is minted fresh to the givers by dollar share (own household excluded, rho-capped). Stakes are lent, never burned.",
};

async function board(db, quests) {
  const TOWN = townClone(); // same live-checkout convention as quests.test.mjs
  const { townDay } = await import(townModuleUrl("tools", "quest-progress.mjs"));
  const meta = { quest_day: townDay(), quest_registry: JSON.stringify({ version: 1, quests }) };
  return questBoardFor(db, meta, "keemin", TOWN);
}

const DAILY = { id: "correspond-send", title: "Reach out", cadence: "daily", validation: "automatic", target: 5, reward: "1 stamp per unit" };

test("a pot's bounty row is a board posting, never a resident's quest card", { skip: SKIP }, async () => {
  const b = await board(fundingDb(), [DAILY, BOUNTY_ROW]);
  assert.deepEqual(b.quests.map((q) => q.id), ["correspond-send"],
    "the bounty comes off the card deck — left on, it renders to every resident as a daily quest stuck at 0/150");
  assert.equal(b.pots.list.length, 1, "it renders where it belongs instead — no new verb");
  assert.equal(b.pots.list[0].id, "keeping-ec2");
  assert.ok(b.pots.teach, "the section explains itself where it is read");
});

test("a bounty posting with no pot file behind it is surfaced, not dropped between the two reads", { skip: SKIP }, async () => {
  const b = await board(fundingDb(), [DAILY, { ...BOUNTY_ROW, id: "ghost-pot" }]);
  assert.equal(b.quests.some((q) => q.id === "ghost-pot"), false, "still off the card deck");
  const ghost = b.pots.invalid_rows.list.find((i) => i.row_kind === "pot-posting");
  assert.ok(ghost, "a posting with nothing behind it is named");
  assert.match(ghost.reason, /no WHITE_PAGES\/pot-ghost-pot\.json/);
});

test("the holo teach says what holo is short for, once, from the one constant", () => {
  // The founder, 2026-08-26: holo is short for HOLOGRAPHIC STAMPS, and the
  // office should say so once. The site ships the same sentence as its own
  // constant, so the wording is law — this asserts the words themselves, not
  // just that some expansion exists, because a paraphrase would drift the two
  // surfaces apart silently.
  //
  // AMENDED 2026-09-17. The etymology is the founder's 2026-08-26 sentence and
  // stands; its closing clause — "never spent as postage" — was the repealed law
  // wearing the metaphor's clothes ("non-spendable is repealed; the stamps are
  // like any other, but are holo to signify the special source"), so exactly
  // that clause moved and nothing else did. ⚠ THE SITE'S TWIN MOVES WITH IT:
  // postmark-site src/lib/funding.mjs § HOLO_NAME_LINE and its own falsifier at
  // test/funding.test.mjs. Nothing cross-checks the two repos, so if one of the
  // two PRs lands alone the town teaches two sentences and no suite says so.
  assert.equal(
    HOLO_EXPANSION,
    "short for holographic stamp — the collector's shiny kind, kept in the album and shown; unlike the collector's, this one still spends.",
    "the expansion is law, byte for byte",
  );
  assert.doesNotMatch(HOLO_EXPANSION, /never spent as postage/,
    "the repealed clause must not survive inside the name-teaching, which is the sentence most residents meet first");
  assert.ok(TEACH.holo.includes(HOLO_EXPANSION), "the holo teach composes the constant, never a retyped copy");

  // FIRST MENTION ONLY: every other teach line stays bare "holo", so the
  // expansion teaches once instead of becoming boilerplate.
  const carriers = Object.entries(TEACH).filter(([, v]) => v.includes(HOLO_EXPANSION)).map(([k]) => k);
  assert.deepEqual(carriers, ["holo"], "exactly one teach line carries the expansion");
});

// ════════════════════════════════════════════════════════════════════════════
// POS-218 · THE HAND, CORRECTED — the office folds a pot-correction row with
// the town's own rule, so every reader names the payer the close mints to
// ════════════════════════════════════════════════════════════════════════════

const CORRECTED = `# stamp-ledger — POS-218 fixture
- 2026-09-01 · pot-correction · ref: stripe:cs_early · from outside:stripe to amia · founder-directed-attribution · by: keemin
- 2026-09-02 · pot-receipt · pot:keeping-ec2 · rail: stripe · usd: 10 · from: outside:stripe · ref: stripe:cs_early
- 2026-09-02 · pot-receipt · pot:keeping-ec2 · rail: stripe · usd: 5 · from: outside:stripe · ref: stripe:cs_plain
- 2026-09-03 · pot-receipt · pot:keeping-ec2 · rail: stripe · usd: 50 · from: outside:stripe · ref: stripe:cs_twice
- 2026-09-04 · pot-correction · ref: stripe:cs_twice · from outside:stripe to spark · founder-manual-attribution · by: keemin
- 2026-09-05 · pot-correction · ref: stripe:cs_twice · from outside:stripe to fabel · founder-directed-attribution · by: keemin
- 2026-09-05 · pot-receipt · pot:keeping-ec2 · rail: stripe · usd: 7 · from: outside:stripe · ref: stripe:cs_closed
- 2026-09-30 · holo · outside:stripe · 0 · pot:keeping-ec2 · epoch:2026-09 · ref: stripe:cs_closed
- 2026-10-01 · pot-correction · ref: stripe:cs_closed · from outside:stripe to domovoi · founder-directed-attribution · by: keemin
- 2026-10-01 · pot-correction · ref: stripe:cs_plain · from stan to paz · founder-directed-attribution · by: keemin
- 2026-10-01 · pot-correction · ref: stripe:cs_ghost · from outside:stripe to paz · founder-directed-attribution · by: keemin
`;

test("POS-218 · a pot-correction row is folded by the town's rule: before its receipt, latest-dated wins, stale-from refused, after-close flagged", { skip: SKIP }, async () => {
  // LAW (town tools/stamp-mint.mjs § foldPotReceipts, verbatim): "THE CORRECTION
  //     MUST MATCH THE ROW IT CORRECTS." and "LATEST DATED WINS, and a tie goes
  //     to the later row."
  const entries = parseLedgerText(CORRECTED);
  const f = foldFunding(entries);
  const hands = Object.fromEntries((f.receiptsByPot.get("keeping-ec2") ?? []).map((r) => [r.receipt, r.from]));
  assert.deepEqual(hands, {
    "stripe:cs_early": "amia",            // the correction sits BEFORE its receipt
    "stripe:cs_plain": "outside:stripe",  // its correction names the wrong old hand
    "stripe:cs_twice": "fabel",           // the later correction wins
    "stripe:cs_closed": "domovoi",        // corrected after its close — the hand moves, the holo row does not
  });
  const closed = f.receiptsByPot.get("keeping-ec2").find((r) => r.receipt === "stripe:cs_closed");
  assert.equal(closed.corrected_from, "outside:stripe");
  assert.equal(closed.correction.after_close, true);
  assert.equal(f.invalid.length, 0, "every correction row parses");

  // ONE RULE, NOT TWO: the office's answer is the town's, row for row
  const ENGINE = await import(townModuleUrl("tools", "stamp-mint.mjs"));
  const town = ENGINE.foldPotReceipts(entries);
  assert.deepEqual(Object.fromEntries(town.receipts.map((r) => [r.ref, r.from])), hands, "the office's hand for every receipt is the town's");
  const shape = (cs) => cs.map((c) => [c.ref, c.applied, c.refused ?? null, !!c.after_close]).sort();
  assert.deepEqual(shape(f.corrections), shape(town.corrections), "and it applies and refuses exactly what the town does");
});

test("POS-218 · the fund door's pot rows name the corrected hand — the receipt list AND the patron roll", () => {
  // CONSUMER: hydrate writes receiptsByPot → pot_receipts.payer and rollByPot →
  // funding_roll.patron; potBoard (the town's quest board and the household's
  // own board) reads both. This is that path in miniature.
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  const f = foldFunding(parseLedgerText(CORRECTED));
  const insRoll = db.prepare("INSERT INTO funding_roll (patron, pot, usd, date, receipt, holo) VALUES (?,?,?,?,?,?)");
  for (const [pot, rs] of f.rollByPot) for (const r of rs) insRoll.run(r.patron, pot, r.usd, r.date, r.receipt, r.holo);
  const insRcpt = db.prepare("INSERT INTO pot_receipts (pot, rail, usd, date, receipt, payer) VALUES (?,?,?,?,?,?)");
  for (const [pot, rs] of f.receiptsByPot) for (const r of rs) insRcpt.run(pot, r.rail, r.usd, r.date, r.receipt, r.from);
  db.prepare("INSERT INTO pots (id, json) VALUES (?,?)").run("keeping-ec2", JSON.stringify(POT_FILE));
  const pot = potBoard(db).list[0];
  const payers = Object.fromEntries(pot.receipts.list.map((r) => [r.receipt, r.payer]));
  assert.equal(payers["stripe:cs_twice"], "fabel", "the $50 is fabel's on the door, as the close mints it");
  assert.equal(payers["stripe:cs_plain"], "outside:stripe", "an uncorrected outside receipt stays outside");
  assert.deepEqual(pot.patrons.roll.map((x) => [x.receipt, x.patron]), [["stripe:cs_closed", "domovoi"]], "the roll names the corrected hand for a settled receipt");
  // sums are hand-blind: a correction moves no dollars
  assert.equal(pot.receipts.sum_usd, 72);
});

// ── POS-184 · a fund names its stakers, not only its payers ──────────────────
// The pot board has always carried ONE number for the escrow — how much is
// staked — and nothing about whose it is. `funding_roll` and `pot_receipts` are
// read row by row (who paid, how much, when) while the stamps behind the same
// pot were a single integer, so the question an agent actually asks before it
// stakes — "who else already has?" — had no answer at any door.
//
// The fold already knew. `foldFunding`'s `escrow()` writes potEscrow and
// potEscrowByHandle in ONE call, from the same row, with the same sign; the
// per-staker list is that second key materialized, never a second derivation.
// That is why the sum-equality below is a property and not a coincidence.

test("POS-184 — the board names WHO staked, netted by the fold's own second key", () => {
  const pot = potBoard(fundingDb()).list[0];

  // 1 · THE LIST. The fixture ledger stakes three residents on keeping-ec2 and
  //     drains two of them by the two lawful routes — limen's 2 returns whole
  //     (`for: pot-return:2026-08`), wright's 4 burns (`→ BURN · for: keeping:`).
  //     Only keemin's 6 is still standing, so only keemin is a staker.
  assert.deepEqual(pot.escrow.stakers, [{ handle: "keemin", staked: 6 }],
    "the pot names its standing stakers, by handle and by size");

  // 2 · A CLOSED POSITION IS NOT A STAKE. Both drained residents are ABSENT,
  //     not listed at 0 — the same "absent == zero, one representation" the pot
  //     total keeps. A reader must not be able to mistake someone who took their
  //     stamps home for someone standing behind the pot today.
  const named = pot.escrow.stakers.map((s) => s.handle);
  assert.equal(named.includes("limen"), false, "a returned stake leaves no staker behind");
  assert.equal(named.includes("wright"), false, "and neither does a burned one");


  // 4 · THE ORDER IS TOTAL — biggest first, ties broken by handle — so the rows
  //     never ride on SQLite's insertion order, which is a hydrate detail.
  const many = fundingDb();
  many.prepare("INSERT INTO pot_stakers (pot, handle, staked) VALUES (?,?,?)").run("keeping-ec2", "aaa", 6);
  many.prepare("INSERT INTO pot_stakers (pot, handle, staked) VALUES (?,?,?)").run("keeping-ec2", "zzz", 9);
  assert.deepEqual(potBoard(many).list[0].escrow.stakers.map((s) => s.handle), ["zzz", "aaa", "keemin"],
    "sorted by stake desc, then by handle — a tie is not left to the rowid");
});

test("POS-184 — sum(stakers) IS `staked`, and the flip that breaks the netting turns this red", () => {
  // THE LOAD-BEARING INVARIANT, in a test of its own on purpose: in the test
  // above it sat behind a list assertion that fires first, so a flip breaking
  // the netting reddened that line and this claim was never actually exercised.
  // A probe standing behind another probe is not a probe.
  //
  // The warrant for showing a list beside a number is that they cannot disagree.
  // They cannot because foldFunding's escrow() helper writes potEscrow and
  // potEscrowByHandle in ONE call from ONE row with ONE sign — the list is the
  // fold's own second key, never a second derivation. Break exactly that (count
  // stakes only on the by-handle arm, keep the pot total netted) and the fixture
  // reads 12 against a `staked` of 6.
  const pot = potBoard(fundingDb()).list[0];
  const sum = pot.escrow.stakers.reduce((n, s) => n + s.staked, 0);
  assert.equal(sum, pot.escrow.staked, "sum(stakers) IS `staked` — one escrow, two keys, never two answers");
  assert.equal(pot.escrow.staked, 6, "and `staked` itself is unmoved by this lane");
});

test("POS-184 — a pot nobody has staked answers `stakers: []`, not a missing field", () => {
  // "Nobody yet" is an answer a resident can act on; an absent field is a door
  // that did not look. The pot file lands with no stake row anywhere behind it.
  const db = fundingDb();
  db.prepare("INSERT INTO pots (id, json) VALUES (?,?)")
    .run("unstaked-pot", JSON.stringify({ ...POT_FILE, pot: "unstaked-pot", title: "Nobody has staked here" }));
  const pot = potBoard(db).list.find((p) => p.id === "unstaked-pot");
  assert.ok(pot, "the pot is on the board");
  assert.deepEqual(pot.escrow.stakers, [], "an empty list, present");
  assert.equal(pot.escrow.staked, 0, "beside the zero it sums to");
});
