// say-nonce-record.test.mjs — THE SAY'S RETRY KEY, KEPT ON ITS ACT (POS-265,
// migration 027; Keemin's go 2026-09-27: "a say's nonce is stored on its act in
// Postgres (acts), so a retry after an office restart returns the first say's
// receipt and records nothing new").
//
// The door's own pen (world.mjs § penVoiceAct → appendActFlipped → insertAct)
// writes into the acts-pen stub, and the door's own lookup (world.mjs §
// spentSayNonce) reads it back. The store's answer to "is 027 here" is the
// stub's `also` handler, so both sides of the gate are on trial: a store with
// the column gets the nonce in the INSERT; a store without it gets the
// thirteen-column INSERT it has always had, and the lookup never asks.
//
// The real-Postgres half (a disposable store, a restarted process) is the
// falsifier in docs/2026-09-27/rail/pos-265b/.
//
//   node --test test/say-nonce-record.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.WORLD_CLONE = join(tmpdir(), "postmark-no-world-clone-xyz");
const tmp = mkdtempSync(join(tmpdir(), "postmark-say-nonce-"));
after(() => { try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* litter */ } });

const { installActsPen, uninstallActsPen, RECORD_ON } = await import("./acts-pen-stub.mjs");
const { penVoiceAct, spentSayNonce, actsHaveNonce, __forgetActsNonce } = await import("../src/world.mjs");
const { openDynamic } = await import("../src/dynamic-store.mjs");
const { currentCrossing } = await import("../src/crossings.mjs");

const setEnv = (env) => { for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
const saved = { WORLD2_PG: process.env.WORLD2_PG, WORLD2_PG_URL: process.env.WORLD2_PG_URL, W2_PEN: process.env.W2_PEN };
after(() => { setEnv(saved); uninstallActsPen(); });

const PROBE = /information_schema\.columns/i;
const store = (kept) => installActsPen({ also: [[PROBE, () => ({ rows: [{ kept }], rowCount: 1 })]] });
let dbN = 0;
const deps = () => ({
  witnessStampAt: async () => ({ at: { anchor: "the-town/the-quay", dx: 0, dy: 0 }, witnesses: null }),
  currentCrossing: () => currentCrossing(),
  openDynamic: () => openDynamic(join(tmp, `dyn-${++dbN}.db`)),
});
const voice = (t) => ({ handle: "caelan", text: "an entrance", at: t, x: 0, y: 0, place: "the quay", aboard: false });

test("027 STANDS: the say's act carries its nonce, and the record hands the first say's instant back", async () => {
  setEnv({ ...RECORD_ON, W2_PEN: "say" });
  __forgetActsNonce();
  const pen = store(true);
  const t = Date.now();
  const r = await penVoiceAct(voice(t), { nonce: "enter-1" }, deps());
  assert.equal(r.ok, true);
  const [act] = pen.rows();
  assert.equal(act.action, "say");
  assert.equal(act.nonce, "enter-1", "the nonce is on the act, in its own column");
  assert.ok(!String(act.payload).includes("enter-1"), "and not in the payload, which leaves the box in the notary's archive");
  assert.equal(await spentSayNonce("caelan", "enter-1", t - 60_000), t);
  assert.equal(await spentSayNonce("caelan", "enter-2", t - 60_000), null, "another nonce is not spent");
  assert.equal(await spentSayNonce("rei", "enter-1", t - 60_000), null, "a nonce is its speaker's own");
});

test("027 ABSENT: the INSERT names no nonce column, and the lookup never asks the acts table", async () => {
  setEnv({ ...RECORD_ON, W2_PEN: "say" });
  __forgetActsNonce();
  const pen = store(false);
  const r = await penVoiceAct(voice(Date.now()), { nonce: "enter-1" }, deps());
  assert.equal(r.ok, true, "a store without 027 still takes the voice");
  const insert = pen.asked().find((q) => /^INSERT INTO acts/i.test(q));
  assert.ok(!/nonce/i.test(insert), `the INSERT named a column the store lacks: ${insert}`);
  const asked = pen.asked().length;
  assert.equal(await spentSayNonce("caelan", "enter-1", 0), null);
  assert.equal(pen.asked().length, asked, "no store query: the probe's no is remembered");
});

test("NO RECORD: an office pointed at no store answers the lookup with null, never an error", async () => {
  setEnv({ WORLD2_PG: undefined, WORLD2_PG_URL: undefined, W2_PEN: undefined });
  __forgetActsNonce();
  assert.equal(await actsHaveNonce(), false);
  assert.equal(await spentSayNonce("caelan", "enter-1", 0), null);
});

test("A SAY WITHOUT A NONCE writes the thirteen-column act it always has, whatever the store", async () => {
  setEnv({ ...RECORD_ON, W2_PEN: "say" });
  __forgetActsNonce();
  const pen = store(true);
  await penVoiceAct(voice(Date.now()), {}, deps());
  const insert = pen.asked().find((q) => /^INSERT INTO acts/i.test(q));
  assert.ok(!/nonce/i.test(insert));
  assert.equal(pen.rows()[0].nonce, undefined);
});
