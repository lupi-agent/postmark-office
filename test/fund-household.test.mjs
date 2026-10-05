// fund-household.test.mjs — a payment is credited to the payer's HOUSEHOLD, minted into each rail's
// own reference (POS-317, Keemin 2026-10-02).
//
//   node --test test/fund-household.test.mjs
//
// The law, quoted (docs/2026-09-21/design-notes/pos-157-fund-attribution-addendum.md, Keemin's
// direction): "attribution is to the HOUSEHOLD, and the reference is minted ... so the watcher reads
// it back ... and nobody types anything." And his rulings of 2026-10-02: a signed-in payer sees their
// household's name and types nothing; a signed-out payer is an outside gift.
//
// `from:` stays a resident HANDLE (measured: the close reads it as one —
// docs/2026-10-02/rail/fund-household/measure-from.out), so the household resolves to ONE resident,
// by the join bundle's first-resident rule (src/fund-holder.mjs § holderOf).
//
// The gate (the brief, and Wright's two additions):
//   1. a reference naming an account → `from:` the household's holder, on card, PayPal and USDC;
//   2. a bare pot → the typed-field path, unchanged;
//   3. an account no household holds → outside:<rail>;
//   4. a payer part that is not an account → outside, never guessed;
//   5. an old PayPal `<pot>|<handle>` order still resolves;
//   6. the same payment twice → once;
//   7. a household with several residents → the rule's resident, named on the row;
//   8. a household whose slug carries dots resolves by account all the same (slugs never ride a reference).

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

import { NO_TOWN, townClone, townModuleUrl } from "./fixture-paths.mjs";
import { townLoginHands } from "../src/household-logins.mjs";
import {
  parseFundRef, fundRefFor, holderOf, fundHolder, firstResident, houseForAccount, parseAccountRef, fundHolderAtOffice, payerRegistry,
} from "../src/fund-holder.mjs";
import { startPayerStore } from "./helpers/payer-store.mjs";
import { decide as stripeDecide, HANDLE_FIELD } from "../tools/stripe-watch.mjs";
import { decide as paypalDecide } from "../tools/paypal-watch.mjs";
import { fundVerify } from "../src/fund.mjs";

const TOWN = [townClone()].filter(Boolean).find((p) => existsSync(join(p, "tools", "stamp-mint.mjs")));
const ENGINE = TOWN ? await import(townModuleUrl("tools", "stamp-mint.mjs")) : null;
const SKIP = !TOWN && NO_TOWN;

// ── the registry: four households, their accounts and residents ─────────────
//   harbor  — two residents, both pinned; bram pinned FIRST (alphabetical would pick ada)
//   carols  — one resident
//   dotted  — a grandfathered slug with dots, one resident
//   shared  — a meep (bugcatcher) and a resident; the meep is never the holder
const HOUSES = {
  "the-harbor": { name: "The Harbor", accounts: [{ login: "harbor-gh", id: 101 }], residents: ["ada", "bram"] },
  carols: { name: "Carol's", accounts: [{ login: "carol-gh", id: 202 }], residents: ["carol"] },
  "victor-b.-rose-e.": { name: "Victor & Rose", accounts: [{ login: "vr-gh", id: 303 }], residents: ["victor"] },
  shared: { name: "Shared", accounts: [{ login: "sh-gh", id: 404 }], residents: ["bugcatcher", "dana"] },
};
const PINS = {
  ada: { login: "harbor-gh", id: 101, pinned: "2026-08-10" },
  bram: { login: "harbor-gh", id: 101, pinned: "2026-08-02" },
  carol: { login: "carol-gh", id: 202, pinned: "2026-08-05" },
  victor: { login: "vr-gh", id: 303, pinned: "2026-08-06" },
  dana: { login: "sh-gh", id: 404 },
  paz: { login: "p", id: 2, pinned: "2026-07-01" },
};
const REGISTRY = { houses: HOUSES, pins: PINS };
const isMeep = (h) => h === "bugcatcher";

function seamTown() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const repo = mkdtempSync(join(tmpdir(), "fund-household-"));
  mkdirSync(join(repo, "tools"), { recursive: true });
  mkdirSync(join(repo, "WHITE_PAGES"), { recursive: true });
  writeFileSync(join(repo, "tools", "github-ids.json"), JSON.stringify(PINS));
  writeFileSync(join(repo, "tools", "households.json"), JSON.stringify({ schema_version: 1, households: HOUSES }));
  for (const h of ["ada", "bram", "carol", "victor", "dana", "paz", "bugcatcher"]) {
    mkdirSync(join(repo, "WHITE_PAGES", h), { recursive: true });
    writeFileSync(join(repo, "WHITE_PAGES", h, "ADDRESS.md"), `---\nhandle: ${h}\n---\n`);
  }
  writeFileSync(join(repo, "WHITE_PAGES", "mail-ledger.md"), "# ledger\n\n- 2026-06-12 · m-1 · ada → paz · thread: new\n");
  writeFileSync(join(repo, "tools", "stamp-pubkey.pem"), publicKey.export({ type: "spki", format: "pem" }));
  writeFileSync(join(repo, "ECONOMY-DIALS.json"), JSON.stringify({ law_side: { town_issuance: { treasury_handle: "the-town", once_purposes: [] }, keeping: { sigma: 0.5, rho: 0.5, rho_constitutional_ceiling: 0.5 } } }));
  writeFileSync(join(repo, "WHITE_PAGES", "pot-keep.json"), JSON.stringify({ pot: "keep", status: "open", beneficiary: "keeper", target_usd_per_epoch: 1000, epoch_cadence: "monthly", received_usd: 0 }));
  const keyFile = join(repo, "stamp-key.pem");
  writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }));
  execFileSync(process.execPath, [join(TOWN, "tools", "stamp-mint.mjs"), "--append", "--key", keyFile, "--repo", repo], { encoding: "utf8" });
  return { repo, keyFile };
}
const entriesOf = (repo) => ENGINE.parseStampLedger(readFileSync(join(repo, "WHITE_PAGES", "stamp-ledger.md"), "utf8"));

const DUE = Math.floor(Date.parse("2026-09-27T12:00:00Z") / 1000);
const NOW = Date.parse("2026-09-29T20:00:00Z");
const session = ({ id, ref, typed = null }) => ({
  id, object: "checkout.session", created: DUE, status: "complete", payment_status: "paid", livemode: true,
  amount_total: 2500, currency: "usd", client_reference_id: ref, customer_details: { email: "payer@example.test" },
  custom_fields: typed == null ? [] : [{ key: HANDLE_FIELD, type: "text", text: { value: typed } }], payment_intent: `pi_${id}`,
});
const txn = ({ id, custom }) => ({ transaction_info: { transaction_id: id, transaction_event_code: "T0006", transaction_initiation_date: "2026-09-27T12:00:00Z",
  transaction_amount: { currency_code: "USD", value: "25.00" }, transaction_status: "S", custom_field: custom } });

function stripe(town, sessions, { entries = entriesOf(town.repo), registry = REGISTRY } = {}) {
  return stripeDecide({ sessions, engine: ENGINE, entries, clone: town.repo, households: ENGINE.householdKeys(town.repo),
    loginHands: townLoginHands(town.repo, ENGINE), registry, isMeep, now: NOW });
}
function paypal(town, transactions) {
  return paypalDecide({ transactions, live: true, engine: ENGINE, entries: entriesOf(town.repo), clone: town.repo,
    households: ENGINE.householdKeys(town.repo), loginHands: townLoginHands(town.repo, ENGINE), registry: REGISTRY, isMeep, now: NOW });
}
const byId = (rows, key) => new Map(rows.map((r) => [r[key], r]));

// ── the reference: one shape per rail, read back ────────────────────────────

test("the reference: Stripe `<pot>_g<id>`, PayPal `<pot>|g<id>`, bare `<pot>` signed out; it reads back", () => {
  assert.equal(fundRefFor("keep", 101, "stripe"), "keep_g101");
  assert.equal(fundRefFor("keep", 101, "paypal"), "keep|g101");
  assert.equal(fundRefFor("keep", null, "stripe"), "keep");
  assert.deepEqual(parseFundRef("keep_g101", "stripe"), { pot: "keep", account: "101", typed: null });
  assert.deepEqual(parseFundRef("keep", "stripe"), { pot: "keep", account: null, typed: null });
  assert.deepEqual(parseFundRef("darko-fund|paz", "paypal"), { pot: "darko-fund", account: null, typed: "paz" });
  assert.deepEqual(parseFundRef("keep_victor-b.-rose-e.", "stripe"), { pot: "keep", account: null, typed: "victor-b.-rose-e." }, "a slug is not an account");
  for (const bad of ["g0", "g", "gabc", "101", "g-1"]) assert.equal(parseAccountRef(bad), null, bad);
  assert.ok(/^[A-Za-z0-9_-]+$/.test(fundRefFor("keeping-ec2", 273009068, "stripe")), "Stripe's alphabet: letters, digits, - and _");
  assert.ok(fundRefFor("keeping-ec2", "99999999999999999999", "paypal").length <= 127);
});

test("7 · the holder: the join bundle's first resident — earliest pin, ties alphabetical, unpinned last, meeps never", () => {
  assert.equal(holderOf("the-harbor", { ...REGISTRY, isMeep }).handle, "bram", "bram was pinned first; alphabetical would have said ada");
  assert.equal(holderOf("shared", { ...REGISTRY, isMeep }).handle, "dana", "the meep is skipped even where it sorts first");
  assert.equal(firstResident(["zed", "amy"], { zed: { pinned: "2026-01-01" } }), "zed", "a pinned resident precedes an unpinned one");
  assert.equal(firstResident(["zed", "amy"], {}), "amy", "with no pins, alphabetical");
  assert.equal(houseForAccount(303, HOUSES), "victor-b.-rose-e.");
  assert.equal(fundHolder(999, { registry: REGISTRY }), null, "an account no household holds has no holder");
  // the seam for Keemin's open call (the household chooses): one function, the rule injected
  const chosen = holderOf("the-harbor", { ...REGISTRY, choose: () => "ada", rule: "household-choice" });
  assert.deepEqual([chosen.handle, chosen.rule], ["ada", "household-choice"]);
});

// ── the card rail ───────────────────────────────────────────────────────────

test("1 · 7 · 8 · card: `<pot>_g<id>` → `from:` the household's holder; several residents → the rule's, named; a dotted slug resolves by account", { skip: SKIP }, () => {
  const town = seamTown();
  const { todo, report } = stripe(town, [session({ id: "cs_carol", ref: "keep_g202" }), session({ id: "cs_harbor", ref: "keep_g101" }), session({ id: "cs_dots", ref: "keep_g303" })]);
  assert.equal(report.anomalies, 0, JSON.stringify(report.anomaly));
  const w = byId(todo, "session");
  assert.deepEqual([w.get("cs_carol").from, w.get("cs_carol").household, w.get("cs_carol").attributed, w.get("cs_carol").attributed_via], ["carol", "carols", true, "household"]);
  assert.deepEqual([w.get("cs_harbor").from, w.get("cs_harbor").household], ["bram", "the-harbor"]);
  assert.match(w.get("cs_harbor").household_note, /household The Harbor \(account g101\); its stamps are held by bram, its first resident among ada, bram/);
  assert.deepEqual([w.get("cs_dots").from, w.get("cs_dots").household], ["victor", "victor-b.-rose-e."]);
  rmSync(town.repo, { recursive: true, force: true });
});

test("2 · card: a bare `<pot>` keeps the typed-field path, unchanged", { skip: SKIP }, () => {
  const town = seamTown();
  const { todo } = stripe(town, [session({ id: "cs_typed", ref: "keep", typed: "paz" }), session({ id: "cs_none", ref: "keep" })]);
  const w = byId(todo, "session");
  assert.deepEqual([w.get("cs_typed").from, w.get("cs_typed").attributed_via], ["paz", "handle"]);
  assert.equal(w.get("cs_none").from, "outside:stripe", "signed out and nothing typed is an outside gift");
  rmSync(town.repo, { recursive: true, force: true });
});

test("3 · 4 · card: an account no household holds → outside:stripe; a payer part that is not an account → outside, never guessed", { skip: SKIP }, () => {
  const town = seamTown();
  const { todo } = stripe(town, [session({ id: "cs_stranger", ref: "keep_g999" }), session({ id: "cs_slug", ref: "keep_carols", typed: "carol" })]);
  const w = byId(todo, "session");
  assert.equal(w.get("cs_stranger").from, "outside:stripe");
  assert.match(w.get("cs_stranger").gift_note, /account g999, which no household holds/);
  assert.equal(w.get("cs_slug").from, "outside:stripe", "a slug in the reference is not read as a household, and the typed field is not consulted behind it");
  assert.match(w.get("cs_slug").gift_note, /"carols", which is not an account reference/);
  rmSync(town.repo, { recursive: true, force: true });
});

test("card: an account reference with no readable registry is held as an anomaly, never filed as a gift", { skip: SKIP }, () => {
  const town = seamTown();
  const { todo, report } = stripe(town, [session({ id: "cs_blind", ref: "keep_g202" })], { registry: null });
  assert.equal(todo.length, 0);
  assert.equal(report.anomaly[0].anomaly, "no-registry");
  rmSync(town.repo, { recursive: true, force: true });
});

test("6 · card: the same payment twice → once (the ledger already holds its ref)", { skip: SKIP }, () => {
  const town = seamTown();
  execFileSync(process.execPath, [join(TOWN, "tools", "epoch-close.mjs"), "--receipt", "--pot", "keep", "--rail", "stripe", "--usd", "25", "--from", "carol", "--ref", "stripe:cs_carol", "--date", "2026-09-28", "--key", town.keyFile, "--repo", town.repo], { encoding: "utf8" });
  const { todo, report } = stripe(town, [session({ id: "cs_carol", ref: "keep_g202" })]);
  assert.equal(todo.length, 0, "it was witnessed a second time");
  assert.deepEqual(report.already.map((a) => [a.session, a.from]), [["cs_carol", "carol"]]);
  rmSync(town.repo, { recursive: true, force: true });
});

// ── the PayPal rail ─────────────────────────────────────────────────────────

test("1 · 3 · 5 · PayPal: `<pot>|g<id>` → the holder; an old `<pot>|<handle>` order still resolves; an unheld account → outside:paypal", { skip: SKIP }, () => {
  const town = seamTown();
  const { todo } = paypal(town, [txn({ id: "PP-HARBOR", custom: "keep|g101" }), txn({ id: "PP-OLD", custom: "keep|paz" }), txn({ id: "PP-STRANGER", custom: "keep|g999" })]);
  const w = byId(todo, "txn");
  assert.deepEqual([w.get("PP-HARBOR").from, w.get("PP-HARBOR").household], ["bram", "the-harbor"]);
  assert.deepEqual([w.get("PP-OLD").from, w.get("PP-OLD").attributed_via], ["paz", "handle"]);
  assert.equal(w.get("PP-STRANGER").from, "outside:paypal");
  rmSync(town.repo, { recursive: true, force: true });
});

// ── the USDC rail: the /fund door ───────────────────────────────────────────

// POS-346: the door and the page resolve from the store, seeded with the fixture's files.
let payerStore = null;
before(async () => {
  if (SKIP) return;
  payerStore = await startPayerStore({ db: "fund_household" });
  Object.assign(process.env, payerStore.env);
});
after(async () => { if (payerStore) await payerStore.stop(); });

const TX = "0x" + "ab".repeat(32);
const verified = async () => ({ verified: true, txhash: TX, usd: 25, receipt_ref: `usdc:${TX}`, from_address: "0x1", to: "0x2", pot: null });

test("1 · 3 · USDC: the form's `household: g<id>` → `from:` the holder; an unheld account is refused by name; household and handle together are refused", { skip: SKIP }, async () => {
  const town = seamTown();
  await payerStore.seedFrom(town.repo);
  const recorded = [];
  const record = async (r) => { recorded.push(r); return { line: "x", commit: null }; };
  const ok = await fundVerify(town.repo, { txhash: TX, pot: "keep", household: "g101" }, { verify: verified, record, engine: ENGINE, potMap: new Map() });
  assert.deepEqual([recorded[0].from, ok.handle, ok.household, ok.household_name], ["bram", "bram", "the-harbor", "The Harbor"]);
  await assert.rejects(fundVerify(town.repo, { txhash: TX, pot: "keep", household: "g999" }, { verify: verified, record, engine: ENGINE, potMap: new Map() }),
    (e) => e.code === 404 && /no household holds account g999/.test(e.defect));
  await assert.rejects(fundVerify(town.repo, { txhash: TX, pot: "keep", household: "g101", handle: "ada" }, { verify: verified, record, engine: ENGINE, potMap: new Map() }),
    (e) => e.code === 422 && /two answers to one question/.test(e.defect));
  await assert.rejects(fundVerify(town.repo, { txhash: TX, pot: "keep", household: "carols" }, { verify: verified, record, engine: ENGINE, potMap: new Map() }),
    (e) => e.code === 422 && /not an account reference/.test(e.defect));
  assert.equal(recorded.length, 1);
  rmSync(town.repo, { recursive: true, force: true });
});

// ── the page asks the same function (GET /me's fund_holder) ─────────────────

test("the page's answer is the watcher's: fundHolderAtOffice reads the store's registry and names the same holder", { skip: SKIP }, async () => {
  const town = seamTown();
  await payerStore.seedFrom(town.repo);
  assert.deepEqual(Object.keys((await payerRegistry()).houses), Object.keys(HOUSES));
  const h = await fundHolderAtOffice(town.repo, 101);
  assert.deepEqual([h.household, h.name, h.handle, h.rule], ["the-harbor", "The Harbor", "bram", "first-resident"]);
  assert.equal(await fundHolderAtOffice(town.repo, 999), null);
  assert.equal(await fundHolderAtOffice(town.repo, null), null);
  rmSync(town.repo, { recursive: true, force: true });
});
