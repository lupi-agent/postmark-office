// payer-registry.test.mjs — Stripe, PayPal and USDC resolve the payer through
// the store's registry (POS-346), on a real Postgres.
//
//   node --test test/payer-registry.test.mjs
//
// THE ISSUE'S TEST: a payment from an account bound ONLY in the store credits
// its house. The fixture town's printed tools/households.json and
// tools/github-ids.json don't know the account. The store does, as it does for
// the minutes between a join's ceremony and the drain's next print, or forever
// when the printout was edited by hand. Before this lane the watchers read the
// printout and the payment was an outside gift.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

import { startPayerStore } from "./helpers/payer-store.mjs";
import { fundHolderAtOffice, houseForAccount, payerRegistryVia, resolveAccount } from "../src/fund-holder.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const repo = mkdtempSync(join(tmpdir(), "payer-registry-"));
mkdirSync(join(repo, "tools"), { recursive: true });
for (const h of ["ada", "sol"]) mkdirSync(join(repo, "WHITE_PAGES", h), { recursive: true });
// The PRINTOUT: one house. sol's house is not on it.
writeFileSync(join(repo, "tools", "households.json"), JSON.stringify({ schema_version: 1, households: {
  "the-quay": { name: "The Quay", accounts: [{ login: "ada-gh", id: 101 }], residents: ["ada"], since: "2026-09-01", declared_by: "ada" },
} }));
writeFileSync(join(repo, "tools", "github-ids.json"), JSON.stringify({ ada: { login: "ada-gh", id: 101, pinned: "2026-09-01" } }));

let payers = null;
before(async () => {
  payers = await startPayerStore({ db: "payer_registry_test" });
  Object.assign(process.env, payers.env);
  await payers.seedFrom(repo);
  // THE STORE, one step ahead of its printout: sol's house and pin, bound by the ceremony.
  await payers.owner.query(
    `INSERT INTO households (slug, ord, name, accounts, residents, since, declared_by)
     VALUES ('sols-loft', 1, 'Sol''s Loft', '[{"id": 909, "login": "sol-gh"}]', '{sol}', '2026-10-04', 'sol')`);
  await payers.owner.query(`INSERT INTO household_pins (handle, login, gh_id, pinned) VALUES ('sol', 'sol-gh', 909, '2026-10-04')`);
});
after(async () => {
  if (payers) await payers.stop();
  rmSync(repo, { recursive: true, force: true });
});

test("a payment from an account bound only in the store credits its house, on every rail's resolver", async () => {
  const registry = await payerRegistryVia(payers.owner);
  assert.deepEqual(Object.keys(registry.houses).sort(), ["sols-loft", "the-quay"]);
  assert.deepEqual([...registry.residents].sort(), ["ada", "sol"], "the roll is the store's town_residents");
  // resolveAccount is what stripe-watch, paypal-watch and the /fund door call on `g<id>`.
  const hand = resolveAccount("909", { registry, isMeep: () => false, outside: "outside:stripe" });
  assert.deepEqual([hand.attributed, hand.from, hand.household], [true, "sol", "sols-loft"]);
  assert.equal(resolveAccount("777", { registry, isMeep: () => false, outside: "outside:stripe" }).from, "outside:stripe", "an account no house holds is still a gift");
});

test("GET /me's holder reads the same store: the page names the house the watcher will credit", async () => {
  const h = await fundHolderAtOffice(repo, 909);
  assert.deepEqual([h?.household, h?.name, h?.handle], ["sols-loft", "Sol's Loft", "sol"]);
});

test("a store that can't be read is a refusal, never an empty registry that makes every payer a gift", () => {
  // In a fresh process: this one's pen already holds a pool.
  const probe = `import(${JSON.stringify(pathToFileURL(join(ROOT, "src", "fund-holder.mjs")).href)})` +
    `.then((m) => m.payerRegistry({ env: {} })).then((r) => console.log("ANSWERED", JSON.stringify(r)), (e) => console.log("REFUSED", e.message))`;
  const env = { ...process.env, WORLD2_PG: "", WORLD2_PG_URL: "" };
  const out = execFileSync(process.execPath, ["-e", probe], { encoding: "utf8", env });
  assert.match(out, /^REFUSED .*not pointed at a record/m);
});

test("houseForAccount asks the one deriver's account walk: by id, and nothing else", () => {
  const houses = { a: { accounts: [{ login: "x", id: 101 }] }, "dotted.slug": { accounts: [{ login: "y", id: 303 }] }, legacy: { accounts: [{ login: "z" }] } };
  assert.equal(houseForAccount(101, houses), "a");
  assert.equal(houseForAccount("303", houses), "dotted.slug");
  assert.equal(houseForAccount(5, houses), null);
  assert.equal(houseForAccount("not-a-number", houses), null);
});
