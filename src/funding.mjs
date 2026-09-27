// funding.mjs — the office's read-side fold over the funding seam's ledger rows.
//
// PINNED to the grammar the town lane landed (tools/stamp-mint.mjs § THE
// FUNDING SEAM, branch seam/ledger-legs-aligned @ 3668881b — re-pinned when the
// σ leg became R12's source-tagged mint). Every pattern below was diffed
// mechanically against that tip, not eyeballed: POT_ID_CLASS and EPOCH_CLASS are
// byte-identical to the town's, and so is every row kind below. The six row
// kinds, exactly as the town writes them:
//
//   - <date> · pot-receipt · pot:<pot> · rail: <stripe|usdc|grant> · usd: <n> · from: <payer> · ref: <ref>
//   - <date> · <handle> → stake:pot/<pot> · <n> · via: <api|mail:letter-id>
//   - <date> · stake:pot/<pot> → <handle> · <n> · for: pot-return:<epoch>
//   - <date> · stake:pot/<pot> → <handle> · <n> · for: unstake · via: <founder|api|web>   (a stake taken back BEFORE the close — the founder's word 2026-09-17; not a close, so it never marks an epoch closed)
//   - <date> · stake:pot/<pot> → BURN · <n> · for: keeping:<epoch> · staker: <handle>
//   - <date> · minted · <staker> · <n> · for: keeping:<pot> · epoch:<epoch>
//   - <date> · holo · <payer> · <n> · pot:<pot> · epoch:<epoch> · ref: <ref>
//
// THE FOUNDER'S RULING, 2026-08-26. A seventh row kind was proposed on
// 2026-08-24 to carry a record of dollars alongside holo. It was IDEATION and it
// NEVER SHIPPED: no such row was ever minted, the sealed ledger holds none, and
// the founder ruled that holo stays and there is no replacement noun. So there
// is no second money row and no second register. `pot-receipt` is the ONLY money
// row in this grammar; the record-of-dollars idea survives here as plain prose
// and as a JOIN, never as a name.
//
// WHAT THAT MOVES, and it is the whole of the change: the proposed row used to
// be the only marker that a receipt's ref had been consumed by a close. That
// marker now lives on the HOLO ROW, which the close emits ONCE PER RECEIPT,
// ALWAYS — and its count MAY BE 0. So the holo count is `(\d+)`, not
// `([1-9]\d*)`: a grant, a treasury dollar, an outside payer, a ρ-capped
// household and a sole staker all mint nothing, and every one of them still
// gets its row. Without that, a zero-holo receipt would carry no mark of having
// been settled and every future close would count and mint against it again.
// Widening a count from "positive" to "non-negative" only ever ACCEPTS more, so
// no row that parsed before stops parsing: the widening is replay-safe.
//
// ATTRIBUTION LIVES ON THE RECEIPT. Who paid is the receipt's `from:`, how many
// dollars is its `usd:`, when is its date; a holo row names the receipt it
// settles in `ref:`. Nothing is duplicated and nothing is lost — join holo→
// receipt on `ref` and (payer, dollars, date, receipt, holo) all come back.
// `foldFunding` does exactly that join and returns it as `rollByParty` /
// `rollByPot`.
//
// The regexes below are copied byte-for-byte from that file, and the records
// this module returns carry the town's OWN kind strings and field names
// ('pot-stake', 'keeping-burn', 'holo', … / handle, pot, n, epoch, ref). That
// is deliberate: when the seam reaches the town's main and the office can
// import tools/stamp-mint.mjs live (the stamps precedent — one source of truth
// for the rule), hydrate swaps the import and nothing downstream moves.
//
// Two shapes to hold on to, because guessing them wrong is how a reader lies:
//   - `pot:` and `epoch:` are TIGHT (no space after the colon); `rail: `,
//     `usd: `, `from: `, `ref: `, `staker: `, `via: ` and `for: ` are LOOSE. A
//     tolerant field reader that demands a space drops the pot off every
//     receipt and every holo row in the ledger.
//   - the holo row and the pot-receipt are both ARROW-FREE. For holo that is
//     still the enforcement and not a formatting choice, though the reason
//     changed on 2026-09-17: not "holo has no verbs" (soulbound, repealed — a
//     holo STAMP spends like any other) but that the ROW is a mint and not a
//     movement. Wearing the movement shape would have the balance/mint folds
//     read it as a transfer AND the by-kind credit mint it, paying twice. A
//     movement-shaped holo row is not holo, and this module says so.
//
// Dollars are whole: `usd` is [1-9]\d* in the landed grammar. $10.50 is not a
// smaller payment, it is not a row.
//
// THE σ LEG IS MINT, SOURCE-TAGGED (R12, Keemin 2026-08-21 afternoon; pinned at
// seam/ledger-legs-aligned 3668881b): "the σ leg IS ORDINARY MINT, source-tagged
// (`minted · for: keeping:<pot>`), with NO liquid coin (the coin was paid when
// the stake burned; the row stays purpose-tagged so balance folds never hand
// liquid back). It COUNTS toward the ρ base ... It stays EXCLUDED from the
// genesis parity formula." The noun "keeping-equity" is retired from every
// resident-facing surface; the vocabulary is "minted · for keeping".
//
// THREE SHAPES ARE RETIRED, and this module keeps CLAIMING all three so an old
// row surfaces as invalid under its own name instead of falling silently through
// a reader that no longer recognizes it — being told "this shape was retired" is
// a different thing from being told nothing:
//   - `MINT → <handle> · <n> · for: keeper-equity:<pot>/<epoch>` — the first
//     draft's row, paid to the pot's BENEFICIARY as spendable primary mint.
//   - `· keeping-equity · <staker> · …` — the second draft's row: right
//     recipient, right non-liquidity, retired noun.
//   - `MINT → <staker> · <n> · for: keeping:<pot>` — the smuggle: R12's own
//     source tag wearing a movement arrow. The town returns 'unknown' for all
//     three and the verifier fails the walk on each.
//
// The live row is ARROW-FREE, and that is R12's "no liquid coin" rendered as
// shape: the town's foldBalances and foldMintCount key on the movement shape, so
// neither can see this row, and the readers that should count it opt in by name.
//
// D1 (same day): "ownership is a derived READ = minted (all sources) + holo —
// NOT a tense; no fifth tense node." So the door does not invent a fifth tense
// and does not quietly widen `minted`: it returns an `ownership` block that does
// the summing in the open.
//
// ⚠ `tenses.minted` NO LONGER STAYS THE EARNED PRIMARY NUMBER, and this note
// said it did until 2026-09-17. It is the town's `foldMintCount`, which gains a
// holo arm at the founder's ruling (postmark-town/postmark#2886), so it is
// primary mint PLUS holo. The invariant the old sentence was protecting —
// `liquid = mint_count − staked` — SURVIVES, and it survives for a specific
// reason worth writing down: a holo row credits BOTH sides, the mint count and
// the balance, so widening `minted` by `n` widens `liquid` by the same `n` and
// the subtraction still closes. That is exactly what made the keeping leg
// different: it is mint with NO liquid coin, so folding IT in would widen one
// side only and break the invariant while looking plausible. Holo is a whole
// stamp; the keeping leg is a record. Hence holo is inside `minted` and the
// keeping leg is still named beside it.
//
// SOULBOUND IS REPEALED — THE FOUNDER'S RULING, 2026-09-17, verbatim: "non-
// spendable is repealed; the stamps are like any other, but are holo to signify
// the special source." And, on the cap: "I'm good to let funding minted stamps
// contribute to the max stamps you can get from another fund. it compounds by
// design."
//
// So the sentence this block carried until today — holo is SOULBOUND, never
// spendable, never stakeable, never a balance — is GONE, not softened. Holo is
// fresh mint to a giver, liquid like any stamp; the word names its source and
// its ink. A holo row of `n` is `n` stamps in the payer's balance and in
// minted-cumulative, it stakes and votes and pays and transfers like any stamp,
// and it counts inside the ρ base at the next close.
//
// THE LAW THIS MODULE MUST NEVER BREAK IS NOW THE OTHER ONE, AND IT IS THE
// REASON THIS FILE GAINS NO ARITHMETIC TODAY: this module does not hold a
// balance and never has. Every stamp number the office serves is the TOWN's own
// fold, imported live from the checkout —
//
//   - the `stamps` table (balance/mint_count/staked) is written by
//     src/hydrate.mjs § Stamps from the town's foldBalances / foldMintCount /
//     foldStaked, and src/queries.mjs § stampsDetail reads that table;
//   - both stake clips take their balance from the town's ballotState —
//     src/pot-stake-exec.mjs § clipPotStake and src/stake-exec.mjs via
//     tools/ballot.mjs § clipApply.
//
// `foldFunding` below folds holo as a READOUT — who gave, to which pot, against
// which receipt — and a readout is all it may ever be. Crediting holo to a
// balance HERE would credit it TWICE, because the town's fold already did it
// upstream. The office's numbers therefore change BY DERIVATION at the next
// rehydrate once the town's folds gain their holo arm (postmark-town/postmark
// #2811); what changes in this repo is the words, and one double-count the old
// law had made harmless (src/queries.mjs § ownership).
//
// The arrow-free row shape STAYS, and its reason is now the surviving half of
// the old one: a holo row is a MINT, not a movement. `diagnose` still refuses a
// movement-shaped holo row, under that reason rather than under soulbound.
//
// Malformed rows are SURFACED, never silently rendered or silently dropped: a
// line that claims a funding kind but fails its field law lands in `invalid`
// with a named reason (the-town/the-disclosure — refuse or disclose, never
// quietly substitute). What this module can refuse is what ONE row proves
// wrong about itself: its shape, and the two reserved-pot rules that need no
// other line to see. Whole-ledger law — ref uniqueness, escrow ownership, the
// close-block replay, the meep law, the ρ-cap — is tools/stamp-verify.mjs's,
// and the door points at it rather than half-keeping it.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// The town's kind strings (classifyEntry), in its own order.
export const FUNDING_KINDS = ["pot-stake", "pot-return", "pot-unstake", "keeping-burn", "keeping-mint", "pot-receipt", "pot-correction", "holo"];
// Claimed so they can be refused by name, never parsed as good — see the σ-leg
// note above. A retired shape that reads as silence is indistinguishable from a
// row the door failed to notice.
export const RETIRED_KINDS = ["keeper-equity", "keeping-equity", "keeping-mint-arrowed"];
export const RAILS = new Set(["stripe", "usdc", "grant"]);
// The reserved direct-to-town pot: receipts only — no file, no stakes, no
// close, and its holo rows carry 0 (nothing burned, nothing minted; the town
// never receives from its own seam). The zero row still gets written, because
// it is what says the receipt has been settled.
export const TREASURY_POT = "treasury";

// The caption the door carries on every holo section — exact wording is law
// (Keemin's word, seam night 2026-08-21). Do not paraphrase it.
export const HOLO_CAPTION = "a record of contribution, not a promise of profit";

// What "holo" is short for — exact wording is law (the founder, 2026-08-26),
// and the site ships the same sentence as its own constant. Do not paraphrase
// it, and do not retype it: import it. FIRST-MENTION RULE — the first teach
// line that teaches holo composes this in; every other mention stays bare
// "holo", so the expansion is taught once and never becomes boilerplate.
// AMENDED 2026-09-17 at the founder's ruling ("non-spendable is repealed").
// The etymology is his 2026-08-26 sentence and stands; its closing clause —
// "never spent as postage" — was the repealed law wearing the metaphor's
// clothes, so it is replaced by the one word the ruling changes. The SITE ships
// the twin of this sentence (postmark-site src/lib/funding.mjs § HOLO_NAME_LINE)
// and moves with it: one sentence, two repos, never two spellings.
export const HOLO_EXPANSION = "short for holographic stamp — the collector's shiny kind, kept in the album and shown; unlike the collector's, this one still spends.";

// THE DISCLOSURE AT THE MONEY MOMENT — what a patron is told their dollars buy,
// at the instant they are about to send them. The world carries the same
// sentence in `LOGOS/the-derivation.md § 10`; this is its live instance.
//
// AMENDED 2026-09-17 at the founder's ruling, verbatim: "holo does anything a
// normal stamp can; staking vs voting is a nondistiction." It read "this buys
// ownership and memory, NEVER VOICE" — the repealed law, stated on the live
// door at the one moment it most matters. A vote is a stake (`stake:vote/…`)
// clipping against a fungible balance no door can sort by origin, so the
// stamps money earns vote; what bounds money is rho, the cap on its share of a
// household, and the disclosure now says THAT instead of promising a verb
// withheld. Naming the cap is not optional here: a patron told their stamps
// vote and not told their share is bounded has been told half the truth.
//
// HOISTED to one owner in the same commit. It was typed out twice in
// src/fund.mjs (the verify receipt and the intake card) with nothing
// cross-checking the copies — the exact drift shape the 2026-09-17 citation
// sweep found between this repo and the site. One sentence, one home, two
// callers.
export const WHAT_THIS_BUYS = "this buys stamps that do everything a stamp does, including vote, plus ownership and memory; money's share of your household is capped, and it converts to real value only if the town someday does";

// Teach lines — agents learn at the point of contact, so every new surface
// carries one short self-describing sentence. One home for the wording.
export const TEACH = {
  tenses: "four tenses of one economy: minted is cumulative stamps ever minted to you (only rises), liquid is spendable now, staked is escrowed in open stakes, holo is how much of your minted came from giving — a subset of minted and of liquid, never a pile beside them; liquid + staked = assets. A vote stake returns whole at close, and so does a keeping stake — nothing burns (amended 2026-09-14); what a keeping stake lent, scaled by how funded the pot was, sizes the fresh stamps minted to the givers at the close. `minted` here is primary mint plus holo, the number the tense arithmetic reconciles against; for the whole see the `ownership` block",
  // HOLO'S HOME, and the ONE place the 2026-09-17 ruling is taught in full —
  // the same first-mention discipline HOLO_EXPANSION follows. The tenses,
  // ownership and keeping_mint lines carry only the fact that changed, because
  // four recitals of one ruling is boilerplate on every morning page served.
  holo: `holo is ${HOLO_EXPANSION} It is the record's keepsake for a gift, and since 2026-09-17 one that spends: the founder repealed non-spendable — "the stamps are like any other, but are holo to signify the special source" — so a holo row of n is n stamps in your balance and in minted-cumulative, staking, voting, paying and transferring like any other, and counting toward your cap at the next close. Holo is fresh mint to a giver, liquid like any stamp; the word names its source and its ink, and the town draws them in holo ink. Every witnessed payment gets its row, naming which pot, when, how many dollars; 0 is a real answer, and it is also the mark that the receipt is settled`,
  keeping_mint: "minted · for keeping is RETIRED (2026-09-14): nothing burns, so there is no keeping mint. The row shape stands in the ledger's grammar and reads 0 for everyone. A keeping stake comes home whole, and the close's fresh mint goes to the givers as holo rows — one per receipt it settles, 0 included — ordinary liquid stamps, inside the minted number",
  ownership: "ownership is a READ, not a tense: everything you have ever minted — primary mint from the mail, holo minted to you for giving, plus minted · for keeping — with holo inside the minted number and counted once. Nothing is stored for it: it is derived from the same signed ledger every time you ask, and no part of it is a claim on money",
  pots_section: "the funding pots open on this board — each gathers real dollars toward a named need; anyone can read who funded what, and stamps staked on a pot signal support without becoming the pot's money",
  pot: "a pot is a funding bounty on the quest board: real dollars gathered toward a named need for a named keeper, epoch by epoch; status says where it stands, and a draft pot may not name its keeper yet",
  patrons: "the patrons who funded this pot — each of the ledger's holo rows joined to the pot-receipt its `ref:` names: who paid, how many dollars, when, and the holo minted to them for it",
  escrow: "stamps residents currently have staked on this pot, and `stakers` names WHO holds each of them (biggest first; the sum of the list IS `staked`, and a resident whose position has netted back to nothing is not listed — a closed position is not a stake) — a stake signals that the need matters to you and never becomes the pot's dollars; at the epoch close every stake comes home whole, and the share of the staked mass that the epoch's dollars funded (fund the whole posted need and the whole mass counts, fund half and half of it does) is minted fresh to the givers by dollar share as HOLO ROWS, one per receipt the close settles, 0 included — a giver's own household's stakes left out, rho-capped against their mint from every source, the remainder un-minted. Nothing burns (amended 2026-09-14), and holo stamps are liquid like any other and count toward that cap themselves (amended 2026-09-17: it compounds by design)",
  funding: "how much of this pot's posted need the payers have actually met — dollars the ledger has witnessed that no close has settled yet, over the pot's per-epoch target. This fraction is the ONLY thing dollars are priced against: there is no dollar-to-stamp rate anywhere in the town, so how much a pot matters is measured by how much the community stakes on it, not by what the money says it is worth",
  receipts: "the witnessed payments behind this pot's dollars — rail (stripe, usdc, or grant), whole dollars, and the receipt ref that is unique forever; the pot file's received and this sum are two clocks, disclosed side by side, never silently reconciled",
  invalid: "rows that claim a funding kind but fail its field law — surfaced here by name rather than rendered as if they were good; a forged row cannot buy legitimacy by being listed",
};

// ── ledger line parsing ──────────────────────────────────────────────────────
// Same reading as the town's parseStampLedger (entry lines start "- ", the
// trailing " · sig: …" is the signature, everything before it is canonical) —
// re-stated here only so this fold can run where the town tool predates the
// seam; hydrate feeds it the town-parsed entries when it has them.
export function parseLedgerText(text) {
  const out = [];
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    if (!raw.startsWith("- ")) continue;
    const m = /^(.*) · sig: (\S+)$/.exec(raw);
    out.push(m ? { canonical: m[1], sig: m[2] } : { canonical: raw, sig: null });
  }
  return out;
}

// ── the landed grammar, byte for byte ───────────────────────────────────────
// Copied from tools/stamp-mint.mjs § THE FUNDING SEAM. Keep them literal: the
// point of this module is that it does not paraphrase the town.
const POT_ID_CLASS = String.raw`[a-z0-9][a-z0-9-]*`;
const EPOCH_CLASS = String.raw`\d{4}-\d{2}`;
const POT_RECEIPT_RE = new RegExp(String.raw`^- (\d{4}-\d{2}-\d{2}) · pot-receipt · pot:(${POT_ID_CLASS}) · rail: (stripe|usdc|grant) · usd: ([1-9]\d*) · from: (\S+) · ref: (\S+)$`);
// THE HAND, CORRECTED (the town's `pot-correction`, founder-ruled 2026-08-27):
// a witnessed dollar's payer was wrong, and this row says whose it really was.
// ARROW-FREE, no usd and no pot — it corrects WHOSE dollar, never how many or
// which pot. Copied byte for byte from tools/stamp-mint.mjs POT_CORRECTION_RE
// (town main @ 7ca61113), and applied by foldFunding below with the town's own
// rule from foldPotReceipts — the rule the close mints by.
const POT_CORRECTION_RE = new RegExp(String.raw`^- (\d{4}-\d{2}-\d{2}) · pot-correction · ref: (\S+) · from (\S+) to (\S+) · (\S+) · by: (\S+)$`);
const POT_STAKE_RE = new RegExp(String.raw`^- (\d{4}-\d{2}-\d{2}) · (\S+) → stake:pot\/(${POT_ID_CLASS}) · ([1-9]\d*) · via: (\S+)$`);
const POT_RETURN_RE = new RegExp(String.raw`^- (\d{4}-\d{2}-\d{2}) · stake:pot\/(${POT_ID_CLASS}) → (\S+) · ([1-9]\d*) · for: pot-return:(${EPOCH_CLASS})$`);
// A stake taken back before the close (the town's `pot-unstake`, 2026-09-17):
// the same movement shape as a return — escrow → the staker — but its reason
// is `unstake` and it names how it arrived, exactly as a stake does. It is NOT
// a close: nothing that reads closes may key on it.
const POT_UNSTAKE_RE = new RegExp(String.raw`^- (\d{4}-\d{2}-\d{2}) · stake:pot\/(${POT_ID_CLASS}) → (\S+) · ([1-9]\d*) · for: unstake · via: (\S+)$`);
const KEEPING_BURN_RE = new RegExp(String.raw`^- (\d{4}-\d{2}-\d{2}) · stake:pot\/(${POT_ID_CLASS}) → BURN · ([1-9]\d*) · for: keeping:(${EPOCH_CLASS}) · staker: (\S+)$`);
const KEEPING_MINT_RE = new RegExp(String.raw`^- (\d{4}-\d{2}-\d{2}) · minted · (\S+) · ([1-9]\d*) · for: keeping:(${POT_ID_CLASS}) · epoch:(${EPOCH_CLASS})$`);
// The count is `(\d+)`, NOT `([1-9]\d*)`, and that one character is load-bearing
// — see THE FOUNDER'S RULING at the top. The close writes one holo row per
// receipt whether or not it mints anything, and the zero rows are what mark a
// grant, a treasury dollar, an outside payer, a ρ-capped household and a sole
// staker as SETTLED. Refuse them and every one of those receipts stays
// unconsumed forever, to be counted and minted against at every future close.
const HOLO_MINT_RE = new RegExp(String.raw`^- (\d{4}-\d{2}-\d{2}) · holo · (\S+) · (\d+) · pot:(${POT_ID_CLASS}) · epoch:(${EPOCH_CLASS}) · ref: (\S+)$`);

// ── claiming ────────────────────────────────────────────────────────────────
// Which kind is this line TRYING to be? Cheap tokens, so a near-miss is
// surfaced by name instead of vanishing — the whole reason the invalid list
// exists. A row of the existing grammar (a vote stake, an ordinary mint, a
// world-mark stake, a transfer) claims nothing and passes straight through.
//
// `stake:pot/` is checked first and by arrow shape, because all three keeping
// movements wear it: the ` · pot-return:`/` · keeping:` tails are claimed here
// too, in case one arrives without its arrow.
export function fundingKindOf(canonical) {
  if (canonical.includes("stake:pot/")) {
    if (/→ stake:pot\//.test(canonical)) return "pot-stake";
    if (/stake:pot\/\S* → BURN\b/.test(canonical)) return "keeping-burn";
    if (/stake:pot\/\S* → /.test(canonical) && /for: unstake( |·|$)/.test(canonical)) return "pot-unstake";
    if (/stake:pot\/\S* → /.test(canonical)) return "pot-return";
    return "pot-stake"; // arrow-free: a keeping stake that forgot it is a movement
  }
  if (/ · pot-receipt( |·|$)/.test(canonical)) return "pot-receipt";
  if (/ · pot-correction( |·|$)/.test(canonical)) return "pot-correction";
  // ` · holo · ` (the row) and ` · holo-mint → ` (the shape holo must never
  // wear) both claim holo. A trailing `holo:` FIELD claims nothing — no landed
  // row carries one, and the test demands a space or end-of-line after the
  // word, so a stray `· holo: 0` segment is not mistaken for the row.
  if (/ · holo(-mint)?( |$)/.test(canonical)) return "holo";
  // R12's row: `minted` leads and `for: keeping:<pot>` tags it. Claimed before
  // the burn's `for: keeping:` test below, which would otherwise swallow it.
  if (/ · minted( |$)/.test(canonical)) return "keeping-mint";
  // The retired noun, claimed so it is refused by name rather than by silence.
  if (/ · keeping-equity( |$)/.test(canonical)) return "keeping-equity";
  if (/for: keeper-equity:| · keeper-equity( |·|$)/.test(canonical)) return "keeper-equity";
  // The smuggle: R12's own source tag wearing a movement arrow. Claimed ahead of
  // the burn so it is named for what it is — the shape that would have handed
  // back liquid coin — instead of being diagnosed as a malformed burn.
  if (/→/.test(canonical) && /for: keeping:[a-z0-9]/.test(canonical)) return "keeping-mint-arrowed";
  if (/for: keeping:| · keeping-burn( |·|$)/.test(canonical)) return "keeping-burn";
  if (/for: pot-return:| · pot-return( |·|$)/.test(canonical)) return "pot-return";
  return null;
}

// ── diagnosis ───────────────────────────────────────────────────────────────
// Only ever runs on a line that CLAIMED a kind and failed its regex. Reads
// labels loosely on purpose (tight and loose colons both) so it can say which
// field is wrong rather than "does not match" — including the case where the
// field is present but written in the wrong dialect.
function loose(canonical) {
  const segs = canonical.split(" · ");
  const fields = new Map();
  for (const seg of segs.slice(1)) {
    const m = /^([a-z][a-z-]*):[ ]?(.*)$/.exec(seg);
    if (m && m[2] !== "" && !fields.has(m[1])) fields.set(m[1], m[2]);
  }
  return {
    date: /^- (\d{4}-\d{2}-\d{2})$/.exec(segs[0] ?? "")?.[1] ?? null,
    fields,
    segs,
    get: (k) => fields.get(k) ?? null,
  };
}

const isPot = (v) => v != null && new RegExp(`^${POT_ID_CLASS}$`).test(v);
const isEpoch = (v) => v != null && new RegExp(`^${EPOCH_CLASS}$`).test(v);
const isCount = (v) => v != null && /^[1-9]\d*$/.test(v);
// Holo alone counts from zero: the close writes a row per receipt whether or
// not it mints, so 0 is a lawful amount there and nowhere else.
const isHoloCount = (v) => v != null && /^\d+$/.test(v);
const isHandle = (v) => v != null && /^\S+$/.test(v);

const NO_DATE = "no leading YYYY-MM-DD date segment";
const potReason = (kind) => `${kind} names no readable pot — the segment reads \`pot:<id>\` with NO space after the colon (id: lowercase letters, digits and hyphens)`;
const usdReason = (kind, got) => `${kind} usd must be a positive WHOLE number of dollars, got ${JSON.stringify(got)} — the landed grammar has no fractional dollars`;
const epochReason = (kind) => `${kind} names no readable epoch — the segment reads \`epoch:YYYY-MM\` (tight) on holo and keeping mint, \`for: keeping:YYYY-MM\` on a burn`;

// Each diagnoser returns a named reason, or a last-resort shape complaint.
function diagnose(kind, canonical) {
  const L = loose(canonical);
  if (!L.date) return NO_DATE;
  // Before any field talk: a holo row that moves is refused by the shape law,
  // not by whatever else it also got wrong. Saying "your colon has a space" to a
  // row that wears an arrow would be answering the smaller question.
  //
  // AMENDED 2026-09-17: the REFUSAL is unchanged and the REASON is not. It used
  // to be "holo has no verbs" — that was soulbound, and soulbound is repealed
  // (holo stamps stake, vote, pay and transfer like any stamp). What survives is
  // the other half, and it is why the shape still cannot move: a holo row is a
  // MINT, not a movement. An arrow would put one row inside the movement folds
  // AND inside the by-kind mint credit, and the payer would be paid twice.
  if (kind === "holo" && /→/.test(canonical))
    return "a holo row is ARROW-FREE by design — it is a MINT, not a movement (holo stamps spend like any other, but the row that creates them is not a transfer), so an arrow would have the movement folds and the by-kind mint credit both read it and pay the payer twice";
  // Then the likeliest authoring mistake, and the one a field-by-field reason
  // would otherwise hide behind a later field: on the three ARROW-FREE kinds
  // `pot:` and `epoch:` are tight, so a space after either colon means a reader
  // sees no pot or no epoch at all, whatever else the row got right. The
  // movement kinds carry no `pot:` segment in any dialect — they wear the pot
  // in the path (`stake:pot/<id>`) or the cause (`keeper-equity:<pot>/<epoch>`)
  // — so for those a stray one is evidence of the wrong shape, and the shape
  // checks below get to say so instead.
  if (kind === "pot-receipt" || kind === "holo" || kind === "keeping-mint") {
    const dialect = /(?:^|· )(pot|epoch): /.exec(canonical);
    if (dialect) return `${kind} writes \`${dialect[1]}: \` with a space after the colon; the landed grammar writes \`${dialect[1]}:<value>\` with NO space after the colon — a space there is why no reader can find the ${dialect[1]}`;
  }
  switch (kind) {
    case "pot-receipt": {
      if (!isPot(L.get("pot"))) return potReason("pot-receipt");
      const rail = L.get("rail");
      if (!rail || !RAILS.has(rail)) return `pot-receipt rail must be one of stripe|usdc|grant, got ${JSON.stringify(rail)}`;
      if (!isCount(L.get("usd"))) return usdReason("pot-receipt", L.get("usd"));
      if (!isHandle(L.get("from"))) return "pot-receipt names no payer — the witnessed payer rides `from:`";
      if (!isHandle(L.get("ref"))) return "pot-receipt carries no `ref:` — an unwitnessed payment is not a receipt, and the ref is what makes one dollar one mint chance";
      return "pot-receipt has every field but not the landed order: `- <date> · pot-receipt · pot:<pot> · rail: <rail> · usd: <n> · from: <payer> · ref: <ref>`";
    }
    case "holo": {
      const payer = L.segs[2];
      if (!isHandle(payer)) return "holo names no payer — the row reads `· holo · <payer> · <n> ·`";
      if (!isHoloCount(L.segs[3])) return `holo carries no whole amount, got ${JSON.stringify(L.segs[3] ?? null)} — 0 is legal (grant, treasury and outside dollars mint nothing and are still recorded), absence is not`;
      if (!isPot(L.get("pot"))) return potReason("holo");
      if (!isEpoch(L.get("epoch"))) return epochReason("holo");
      if (!isHandle(L.get("ref"))) return "holo carries no `ref:` — a holo row names the witnessed payment it settles, and that ref is the only thing that says the payment has been counted";
      return "holo has every field but not the landed order: `- <date> · holo · <payer> · <n> · pot:<pot> · epoch:<epoch> · ref: <ref>`";
    }
    case "pot-stake": {
      const m = /(\S+) → stake:pot\/(\S+)/.exec(canonical);
      if (!m) return "names stake:pot/… but carries no movement arrow — a keeping stake is a movement (`<handle> → stake:pot/<pot>`)";
      if (!isPot(m[2])) return potReason("pot-stake");
      if (!isCount(L.segs[2])) return `pot-stake carries no positive whole amount, got ${JSON.stringify(L.segs[2] ?? null)}`;
      if (!isHandle(L.get("via"))) return "pot-stake carries no `via:` — a stake names how it arrived (api, or mail:<letter-id>)";
      return "pot-stake has every field but not the landed order: `- <date> · <handle> → stake:pot/<pot> · <n> · via: <via>`";
    }
    case "pot-return": {
      const m = /stake:pot\/(\S+) → (\S+)/.exec(canonical);
      if (m && !isPot(m[1])) return potReason("pot-return");
      if (!m) return "a pot return is a movement out of escrow: `stake:pot/<pot> → <handle>`";
      if (!isCount(L.segs[2])) return `pot-return carries no positive whole amount, got ${JSON.stringify(L.segs[2] ?? null)}`;
      const forV = L.get("for") ?? "";
      if (!/^pot-return:/.test(forV)) return `a stake leaves a pot for exactly three reasons, and each names itself: \`for: pot-return:<epoch>\` (the close returns it whole), \`for: unstake · via: <channel>\` (taken back before the close, 2026-09-17), or \`for: keeping:<epoch>\` with a BURN target (the pre-2026-09-14 close; nothing burns now). Got ${JSON.stringify(forV || null)}`;
      if (!isEpoch(forV.slice("pot-return:".length))) return epochReason("pot-return");
      return "pot-return has every field but not the landed order: `- <date> · stake:pot/<pot> → <handle> · <n> · for: pot-return:<epoch>`";
    }
    case "pot-unstake": {
      const m = /stake:pot\/(\S+) → (\S+)/.exec(canonical);
      if (m && !isPot(m[1])) return potReason("pot-unstake");
      if (!m) return "a pot unstake is a movement out of escrow: `stake:pot/<pot> → <handle>`";
      if (!isCount(L.segs[2])) return `pot-unstake carries no positive whole amount, got ${JSON.stringify(L.segs[2] ?? null)}`;
      if (!isHandle(L.get("via"))) return "pot-unstake carries no `via:` — a stake taken back names how it was taken (founder, api, or web), exactly as the stake named how it arrived";
      return "pot-unstake has every field but not the landed order: `- <date> · stake:pot/<pot> → <handle> · <n> · for: unstake · via: <via>`";
    }
    case "keeping-burn": {
      const m = /stake:pot\/(\S+) → BURN/.exec(canonical);
      if (!m) return "the keeping burn IS the escrow movement to the reserved BURN account: `stake:pot/<pot> → BURN · <n> · for: keeping:<epoch> · staker: <handle>` — there is no standalone keeping-burn row";
      if (!isPot(m[1])) return potReason("keeping-burn");
      if (!isCount(L.segs[2])) return `keeping-burn carries no positive whole amount, got ${JSON.stringify(L.segs[2] ?? null)}`;
      if (!isEpoch((L.get("for") ?? "").replace(/^keeping:/, ""))) return epochReason("keeping-burn");
      if (!isHandle(L.get("staker"))) return "keeping-burn names no `staker:` — a burn must say whose escrow it drained";
      return "keeping-burn has every field but not the landed order: `- <date> · stake:pot/<pot> → BURN · <n> · for: keeping:<epoch> · staker: <handle>`";
    }
    case "keeping-mint": {
      if (/→/.test(canonical)) return "a keeping mint row is ARROW-FREE — R12: the σ leg carries NO liquid coin (the coin was paid when the stake burned), and arrow-free is what that means mechanically: the movement folds cannot see it. A movement-shaped one is not keeping mint";
      if (!isHandle(L.segs[2])) return "keeping mint names no staker — the row reads `· minted · <staker> · <n> ·`";
      if (!isCount(L.segs[3])) return `keeping mint carries no positive whole amount, got ${JSON.stringify(L.segs[3] ?? null)}`;
      if (!isPot((L.get("for") ?? "").replace(/^keeping:/, ""))) return "keeping mint names no readable pot — the segment reads `for: keeping:<pot>`";
      if (!isEpoch(L.get("epoch"))) return epochReason("keeping mint");
      return "keeping mint has every field but not the landed order: `- <date> · minted · <staker> · <n> · for: keeping:<pot> · epoch:<epoch>`";
    }
    case "pot-correction":
      return "pot-correction does not match the landed shape `- <date> · pot-correction · ref: <ref> · from <old-payer> to <new-payer> · <reason> · by: <who>` — arrow-free, no usd and no pot; only a hand-run `epoch-close.mjs --correct-hand` writes one";
    case "keeper-equity":
      return "keeper-equity is RETIRED and names nothing in the grammar — the σ share does not go to the pot's beneficiary as a spendable mint. It goes home to the stakers, at par of their own burn, as an arrow-free `· minted · <staker> · <n> · for: keeping:<pot> · epoch:<epoch>` row. The town's own reader returns unknown for this shape and the verifier fails the walk on it";
    case "keeping-equity":
      return "the noun `keeping-equity` is RETIRED (R12, 2026-08-21): the σ leg IS ordinary mint, source-tagged, so the row now reads `· minted · <staker> · <n> · for: keeping:<pot> · epoch:<epoch>`. Same recipient, same arrow-free shape, the ruled vocabulary. The town's own reader returns unknown for the old noun and the verifier fails the walk on it";
    case "keeping-mint-arrowed":
      return "a keeping mint row may never carry a movement arrow — R12: the σ leg has NO liquid coin, because the coin was already paid when the stake burned. `MINT → <staker>` would put it inside the balance AND mint-count folds, handing back spendable stamps for a coin already spent. The lawful row is arrow-free: `· minted · <staker> · <n> · for: keeping:<pot> · epoch:<epoch>`";
  }
  return `claims ${kind} but matches no landed shape`;
}

// ── classification ──────────────────────────────────────────────────────────
// Returns null when the line is not a funding row at all (it belongs to the
// existing grammar), a town-shaped record when it parses, or
// { kind: "invalid", … } when it claims a kind and fails that kind's law.
export function classifyFundingRow(canonical) {
  const claimed = fundingKindOf(canonical);
  if (!claimed) return null;
  const bad = (reason) => ({ kind: "invalid", row_kind: claimed, line: canonical, reason });
  let m;

  if (claimed === "pot-receipt" && (m = POT_RECEIPT_RE.exec(canonical)))
    return { kind: "pot-receipt", date: m[1], pot: m[2], rail: m[3], usd: Number(m[4]), from: m[5], ref: m[6] };

  if (claimed === "pot-correction" && (m = POT_CORRECTION_RE.exec(canonical)))
    return { kind: "pot-correction", date: m[1], ref: m[2], from: m[3], to: m[4], reason: m[5], by: m[6] };

  if (claimed === "pot-stake" && (m = POT_STAKE_RE.exec(canonical))) {
    if (m[3] === TREASURY_POT) return bad(`"${TREASURY_POT}" is the reserved direct-to-town pot; it takes direct-to-town receipts, never stakes`);
    return { kind: "pot-stake", date: m[1], handle: m[2], pot: m[3], n: Number(m[4]), via: m[5] };
  }

  if (claimed === "pot-return" && (m = POT_RETURN_RE.exec(canonical))) {
    if (m[2] === TREASURY_POT) return bad(`"${TREASURY_POT}" is the reserved direct-to-town pot; it never stakes, so nothing can return from it`);
    return { kind: "pot-return", date: m[1], pot: m[2], handle: m[3], n: Number(m[4]), epoch: m[5] };
  }

  if (claimed === "pot-unstake" && (m = POT_UNSTAKE_RE.exec(canonical))) {
    if (m[2] === TREASURY_POT) return bad(`"${TREASURY_POT}" is the reserved direct-to-town pot; it never stakes, so nothing can be taken back from it`);
    return { kind: "pot-unstake", date: m[1], pot: m[2], handle: m[3], n: Number(m[4]), via: m[5] };
  }

  if (claimed === "keeping-burn" && (m = KEEPING_BURN_RE.exec(canonical))) {
    if (m[2] === TREASURY_POT) return bad(`"${TREASURY_POT}" is the reserved direct-to-town pot; it takes direct-to-town receipts, never stakes or closes`);
    return { kind: "keeping-burn", date: m[1], pot: m[2], n: Number(m[3]), epoch: m[4], handle: m[5] };
  }

  if (claimed === "keeping-mint" && (m = KEEPING_MINT_RE.exec(canonical))) {
    if (m[4] === TREASURY_POT) return bad(`"${TREASURY_POT}" is the reserved direct-to-town pot; it never closes, so it mints nothing for keeping`);
    return { kind: "keeping-mint", date: m[1], handle: m[2], n: Number(m[3]), pot: m[4], epoch: m[5] };
  }

  if (claimed === "holo" && (m = HOLO_MINT_RE.exec(canonical))) {
    const n = Number(m[3]);
    // The treasury law is UNCHANGED — direct-to-town dollars mint nothing — but
    // it now rides the holo row, because the holo row is what marks a receipt
    // settled. A treasury row of 0 is therefore lawful and REQUIRED; only a
    // treasury row that claims holo is refused.
    if (m[4] === TREASURY_POT && n !== 0) return bad(`"${TREASURY_POT}" dollars mint no holo, and this row claims ${n}; the town never receives from its own seam, so a direct-to-town receipt is settled with a row of 0`);
    return { kind: "holo", date: m[1], handle: m[2], n, pot: m[4], epoch: m[5], ref: m[6] };
  }

  return bad(diagnose(claimed, canonical));
}

// ── the fold ────────────────────────────────────────────────────────────────
// Every funding row in the ledger, sorted into the folds the reads serve, plus
// the invalid list. Pure — entries in, maps out.
//
// Keeping mint is collected into its own map and summed into no TENSE. R12 makes
// it mint, so the `ownership` read counts it in the open — but it is arrow-free,
// carrying no liquid coin, so it can never join liquid, staked, assets, or the
// earned `minted` the tense arithmetic reconciles against.
export function foldFunding(entries) {
  const holoByParty = new Map();   // payer handle -> [{date, pot, holo, epoch, receipt}]
  const keepingByParty = new Map(); // staker handle -> [{date, pot, n, epoch}] — R12's minted-for-keeping rows
  const rollByParty = new Map();   // patron -> [{date, pot, usd, receipt, holo}]  ← holo ⋈ receipt on ref
  const rollByPot = new Map();     // pot -> [{patron, date, usd, receipt, holo}]  ← the same rows, keyed the other way
  const receiptsByPot = new Map(); // pot -> [{date, rail, usd, from, receipt}]
  const potEscrow = new Map();     // pot -> open staked stamps
  // WHOSE escrow, not just how much. The pot total is what a pot's own card
  // needs; a resident deciding whether to stake needs to know what their OWN
  // stamps are already holding, and one integer per pot cannot say. Same rows,
  // same three drains — only the key differs, so the two can never disagree.
  const potEscrowByHandle = new Map(); // handle -> Map(pot -> open staked)
  const invalid = [];
  // The two sides of the join, collected in one pass and joined after it, so a
  // holo row is not required to arrive after the receipt it settles.
  const holoRows = [];
  const byRef = new Map();         // receipt ref -> the pot-receipt row
  const receiptRows = [];          // [{ row, entry }] in ledger order, for the correction pass
  const proposed = new Map();      // receipt ref -> the pot-correction that wins for it
  const push = (map, key, v) => { if (!map.has(key)) map.set(key, []); map.get(key).push(v); };
  const escrow = (pot, delta, handle) => {
    potEscrow.set(pot, (potEscrow.get(pot) ?? 0) + delta);
    if (!handle) return;
    if (!potEscrowByHandle.has(handle)) potEscrowByHandle.set(handle, new Map());
    const mine = potEscrowByHandle.get(handle);
    mine.set(pot, (mine.get(pot) ?? 0) + delta);
  };

  for (const e of entries) {
    const row = classifyFundingRow(e.canonical);
    if (!row) continue;
    switch (row.kind) {
      case "invalid": invalid.push(row); break;
      // escrow in, and the two ways it leaves: an unmatched stake returns whole,
      // a dollar-matched stake burns. Both drain the pot — the burn is not a
      // separate kind of row that leaves the escrow standing.
      case "pot-stake": escrow(row.pot, row.n, row.handle); break;
      case "pot-return": escrow(row.pot, -row.n, row.handle); break;
      // a stake taken back before the close leaves the escrow the same way a
      // return does, and closes nothing
      case "pot-unstake": escrow(row.pot, -row.n, row.handle); break;
      // the burn names its staker in `staker:`, which the classifier hands back
      // as the row's handle — so a burned stake leaves the right books
      case "keeping-burn": escrow(row.pot, -row.n, row.handle); break;
      case "holo":
        push(holoByParty, row.handle, { date: row.date, pot: row.pot, holo: row.n, epoch: row.epoch, receipt: row.ref });
        holoRows.push(row);
        break;
      case "pot-receipt":
      {
        const entry = { date: row.date, rail: row.rail, usd: row.usd, from: row.from, receipt: row.ref };
        push(receiptsByPot, row.pot, entry);
        byRef.set(row.ref, row);
        receiptRows.push({ row, entry });
        break;
      }
      // LATEST DATED WINS, a same-day tie to the later row — the town's rule
      // (foldPotReceipts), so a correction can itself be corrected.
      case "pot-correction": {
        const held = proposed.get(row.ref);
        if (!held || row.date >= held.date) proposed.set(row.ref, row);
        break;
      }
      // The σ leg (R12: mint, source-tagged, no liquid coin). Its own map, so
      // the ownership read can count it deliberately and no tense can catch it
      // by accident.
      case "keeping-mint":
        push(keepingByParty, row.handle, { date: row.date, pot: row.pot, n: row.n, epoch: row.epoch });
        break;
    }
  }
  // THE HAND, CORRECTED — the close's rule, applied the close's way. This pass
  // is tools/stamp-mint.mjs § foldPotReceipts at town main, restated and not
  // re-decided: a second pass (a correction may sit before the receipt it
  // names), the correction must name the hand the receipt currently carries or
  // it is REFUSED by name ('stale-from'), a corrected receipt's `from` becomes
  // the new hand and keeps `corrected_from` and `correction` beside it, a ref a
  // holo row already settled is corrected and flagged `after_close` (its holo
  // row is not touched), and a correction naming no receipt is surfaced as
  // 'no-such-receipt'. It runs BEFORE the join so the roll names the same payer
  // the close minted to. The close reads this rule; the report must not print
  // a third.
  const settledRefs = new Set(holoRows.map((h) => h.ref));
  const corrections = [];
  for (const { row, entry } of receiptRows) {
    const k = proposed.get(row.ref);
    if (!k) continue;
    if (k.from !== row.from) {
      corrections.push({ ref: row.ref, applied: false, refused: "stale-from", says: k.from, receipt: row.from, correction: k });
      continue;
    }
    const correction = { date: k.date, reason: k.reason, by: k.by, from: k.from, to: k.to };
    if (settledRefs.has(row.ref)) correction.after_close = true;
    for (const r of [row, entry]) { r.corrected_from = r.from; r.from = k.to; r.correction = correction; }
    corrections.push({ ref: row.ref, applied: true, after_close: settledRefs.has(row.ref), correction: k });
  }
  for (const [ref, k] of proposed)
    if (!byRef.has(ref)) corrections.push({ ref, applied: false, refused: "no-such-receipt", correction: k });

  // THE JOIN. Attribution lives on the pot-receipt — who paid (`from:`), how
  // many dollars (`usd:`), when (its date) — and a holo row names the receipt
  // it settles in `ref:`. So the roll a patron page reads is holo ⋈ receipt on
  // ref, computed here rather than stored twice. A holo row whose ref no
  // receipt in this ledger carries still rolls, under its own payer with the
  // dollars unknown: whole-ledger law (ref uniqueness, one holo row per
  // receipt) is tools/stamp-verify.mjs's, and dropping the row here would hide
  // from the roll exactly the case an auditor came to see.
  for (const h of holoRows) {
    const r = byRef.get(h.ref);
    const entry = {
      patron: r?.from ?? h.handle,
      date: r?.date ?? h.date,
      pot: h.pot,
      usd: r?.usd ?? null,
      receipt: h.ref,
      holo: h.n,
    };
    push(rollByParty, entry.patron, { date: entry.date, pot: entry.pot, usd: entry.usd, receipt: entry.receipt, holo: entry.holo });
    push(rollByPot, h.pot, entry);
  }
  for (const [k, v] of potEscrow) if (v === 0) potEscrow.delete(k); // absent == zero, one representation
  for (const [h, m] of potEscrowByHandle) {
    for (const [pot, v] of m) if (v === 0) m.delete(pot);
    if (m.size === 0) potEscrowByHandle.delete(h);
  }
  return { holoByParty, keepingByParty, rollByParty, rollByPot, receiptsByPot, potEscrow, potEscrowByHandle, corrections, invalid };
}

// ── pot files (the bounty files on the quest board) ─────────────────────────
// WHITE_PAGES/pot-<id>.json, pinned to the file the town landed
// (pot-keeping-ec2.json): pot, status, title, target_usd_per_epoch,
// epoch_cadence, received_usd, beneficiary, board. A file that will not parse,
// or misses a money field, is surfaced invalid — a pot with no target is not a
// smaller pot, it is not a pot.
//
// `beneficiary` must be PRESENT but may be null: a draft pot names no keeper
// yet, and the town's own close refuses to run until one is named. Requiring a
// non-null keeper here would have surfaced the town's only real pot as
// malformed — a reader calling a lawful draft forged.
// `target_usd_per_epoch` must be PRESENT but may be null — see THE ELASTIC
// AMENDMENT below. `status`, `epoch_cadence` and `received_usd` are still
// required outright: a pot that cannot say whether it is open, how often it
// closes, or what it has taken is not a smaller pot, it is not a pot.
const POT_MONEY_FIELDS = ["status", "epoch_cadence", "received_usd"];

// ── THE ELASTIC AMENDMENT (town main, 2026-08-23) ───────────────────────────
// This reader used to refuse every targetless pot, quoting a law that has since
// been amended. pot-keeping-ec2.json § _target now reads, verbatim:
//
//   "target_usd_per_epoch is the posted need, and it is the ONLY thing dollars
//    are priced against — the funded fraction is min(1, non-treasury dollars /
//    target). A pot with no target cannot close — UNLESS ITS OWN CLOSE WORD
//    SAYS ELASTIC (the DARKO ruling, 2026-08-23): then the need is whatever
//    arrived, floored by its min_close_usd."
//
// And pot-darko-fund.json § _close spells what elastic does:
//
//   "a month's close runs only if the accumulated roll — carried dollars plus
//    this month's — totals at least min_close_usd; otherwise dollars and stakes
//    both stand and ride to the next month … Nothing is ever refused at intake."
//
// So a targetless pot is lawful when it says why, and the reader's job is to
// carry the word rather than to refuse the pot. Until this changed, the MCP
// literally dropped the DARKO box: the town posted a need, and every door
// answered as though it did not exist.
//
// `none` is the other lawful word — the standing box that never closes. A pot
// with NO target and NO close word is still refused, and that refusal is the
// original law doing its remaining job: nothing in the record says how it could
// ever close, so nothing should quote it a funded fraction.
//
// `epoch` is the third, added 2026-08-25 when the keeping pot's record finally
// SPOKE the word it had always ruled in prose (pot-keeping-ec2.json § _close:
// "the word made explicit 2026-08-25 at the founder's word, and it rules
// NOTHING NEW"). This set is an ALLOWLIST — a word it does not hold is dropped
// to null, which reads downstream as "the record has not said". So leaving
// `epoch` out would have made this reader answer the exact falsehood the
// trueing exists to kill, on the exact pot it was written for, while the pot
// went on reading fine because it posts a target.
const CLOSE_WORDS = new Set(["elastic", "none", "epoch"]);
const closeWordOf = (d) =>
  typeof d?.close === "string" && CLOSE_WORDS.has(d.close.trim()) ? d.close.trim() : null;
// The ceremony's floor, in whole dollars. § _min_close: "Owner of the number:
// this file; every surface reads it." Absent is null, never a default — a
// surface that cannot name the floor says so rather than inventing one.
const wholeFloor = (v) => (Number.isInteger(v) && v > 0 ? v : null);
// The posted need must be a whole number of dollars. It is the ONLY thing the
// town prices dollars against (funded = min(1, non-treasury dollars ÷ target)),
// and the town's own close refuses a pot without it — so a pot carrying a
// fractional or zero target is surfaced here rather than rendered with a
// funding fraction nothing could ever close against.
const wholeTarget = (v) => Number.isInteger(v) && v > 0;

export function readPots(townDir) {
  const dir = join(townDir, "WHITE_PAGES");
  const pots = [];
  const invalid = [];
  if (!existsSync(dir)) return { pots, invalid };
  const bad = (name, reason) => invalid.push({ kind: "invalid", row_kind: "pot-file", line: `WHITE_PAGES/${name}`, reason });
  for (const name of readdirSync(dir).filter((n) => /^pot-[a-z0-9-]+\.json$/.test(n)).sort()) {
    const idFromName = name.slice(4, -5);
    let d;
    try { d = JSON.parse(readFileSync(join(dir, name), "utf8")); }
    catch (e) { bad(name, `unparseable JSON: ${String(e?.message ?? e).slice(0, 80)}`); continue; }
    const id = d.pot ?? idFromName;
    if (id === TREASURY_POT) { bad(name, `"${TREASURY_POT}" is the reserved direct-to-town pot — it takes direct-to-town receipts only and has no pot file`); continue; }
    const missing = POT_MONEY_FIELDS.filter((f) => d[f] == null);
    if (!Object.hasOwn(d, "beneficiary")) missing.push("beneficiary");
    if (missing.length) { bad(name, `pot file missing ${missing.join(", ")}`); continue; }
    if (!Object.hasOwn(d, "target_usd_per_epoch")) { bad(name, "pot file missing target_usd_per_epoch"); continue; }
    const close = closeWordOf(d);
    const targetless = d.target_usd_per_epoch == null;
    if (targetless && !close) {
      bad(name, `pot posts no target_usd_per_epoch and names no close word — a pot with no target cannot close unless its own close word says elastic (the DARKO ruling, 2026-08-23); with neither, nothing in the record says how this pot could ever close`);
      continue;
    }
    if (!targetless && !wholeTarget(d.target_usd_per_epoch)) {
      bad(name, `pot posts target_usd_per_epoch ${JSON.stringify(d.target_usd_per_epoch)} — the posted need must be a positive whole number of dollars; it is what the funded fraction is priced against`);
      continue;
    }
    // The word and its floor ride WITH the pot from here on. Every surface
    // downstream branches on them, and none of them may re-derive the law.
    pots.push({ id, data: d, close, min_close_usd: wholeFloor(d.min_close_usd) });
  }
  return { pots, invalid };
}

// A quest-registry bounty row names a pot; the pot file is what the board
// renders. A posting with no file behind it would otherwise fall out of BOTH
// reads silently — so it is surfaced by name, like any other funding row that
// claims something it cannot show.
export function postingsWithoutPots(bountyIds, potIds) {
  const have = new Set(potIds);
  return bountyIds.filter((id) => !have.has(id)).map((id) => ({
    kind: "invalid",
    row_kind: "pot-posting",
    line: `quest-registry.json § ${id}`,
    reason: `the board posts a bounty for pot "${id}" but no WHITE_PAGES/pot-${id}.json stands behind it — the posting has no pot`,
  }));
}
