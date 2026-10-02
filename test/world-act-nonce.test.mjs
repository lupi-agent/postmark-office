// world-act-nonce.test.mjs — A WORLD ACT'S RETRY KEY (POS-246).
//
// "A retried world act writes once." The door's scope (src/act-nonce.mjs) around
// the real write path: `appendJournal` → `penWrite` → `insertAct` →
// `actsInsert`, which asks the scope for the key. The first half runs on the
// acts-pen stub; the second on a REAL Postgres with every schema file applied,
// because migration 052's partial unique index and the 23505 a racing twin
// meets exist only there ("a round trip through a JS stub is not a round trip
// through Postgres"). Without EMBEDDED_PG_DIR the second half SKIPS by name.
//
//   EMBEDDED_PG_DIR=<dir> node --test test/world-act-nonce.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.WORLD_CLONE = join(tmpdir(), "postmark-no-world-clone-xyz");

const { installActsPen, uninstallActsPen, RECORD_ON } = await import("./acts-pen-stub.mjs");
const { actUnderNonce, keptNonce, nonceDefect, WORLD_NONCE_NOT_KEPT } = await import("../src/act-nonce.mjs");
const { appendJournal } = await import("../src/world-journal.mjs");
const { walkEntry } = await import("../src/world.mjs");
const { currentCrossing } = await import("../src/crossings.mjs");
const { __setPoolForTest } = await import("../src/world2-pen.mjs");
const { startStore } = await import("./helpers/embedded-store.mjs");

const setEnv = (env) => { for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
const saved = { WORLD2_PG: process.env.WORLD2_PG, WORLD2_PG_URL: process.env.WORLD2_PG_URL };
after(() => { setEnv(saved); uninstallActsPen(); });

const walk = (who = "caelan", to = "the-town/the-quay") => walkEntry({
  crossing: currentCrossing(), who, targetMarkId: to, stampAt: null, witnesses: null,
  from: { x: 0, y: 0 }, toward: { x: 10, y: 0 }, pace: 60, targetExtent: null,
  household: null, writtenAt: new Date().toISOString(),
});
let runs = 0;
const walkAct = (entry = walk()) => async () => { runs += 1; const r = await appendJournal(null, entry); return { walked: true, act_id: r.actId }; };
const keyed = (over = {}) => actUnderNonce({ action: "walk", nonce: "k1", kept: true, actors: ["caelan"], run: walkAct(), ...over });

// ── the stub half ───────────────────────────────────────────────────────────

test("a keyed walk lands once: the key is on its row, spelled with the door's action, and the answer says it is idempotent", async () => {
  setEnv(RECORD_ON); runs = 0;
  const pen = installActsPen();
  const first = await keyed();
  assert.equal(first.duplicate, undefined);
  assert.equal(first.result.walked, true);
  assert.equal(first.disclosure.nonce, "k1");
  assert.match(first.disclosure.idempotent, /same nonce/);
  const [row] = pen.rows();
  assert.equal(row.nonce, keptNonce("walk", "k1"), "the key rides the act's own INSERT");
  assert.ok(!String(row.payload).includes("k1"), "and never the payload, which leaves the box");

  const again = await keyed();
  assert.equal(runs, 1, "the handler did not run a second time");
  assert.equal(pen.rows().length, 1, "a second row was written for a spent nonce");
  assert.equal(again.duplicate.duplicate, true);
  assert.equal(again.duplicate.act.id, String(row.id), "the receipt is the FIRST act's, read back off its row");
  assert.equal(again.duplicate.act.action, "walk");
  assert.match(again.duplicate.note, /NOTHING WAS WRITTEN A SECOND TIME/);
});

test("a different nonce is a second act; the same word on another door action is a second act", async () => {
  setEnv(RECORD_ON); runs = 0;
  const pen = installActsPen();
  await keyed();
  await keyed({ nonce: "k2" });
  await keyed({ action: "enter" });
  assert.equal(runs, 3);
  assert.deepEqual(pen.rows().map((r) => r.nonce), ["walk:k1", "walk:k2", "enter:k1"]);
});

test("the lookup is the key's own residents': another household's same nonce acts", async () => {
  setEnv(RECORD_ON); runs = 0;
  const pen = installActsPen();
  await keyed();
  const other = await keyed({ actors: ["rei"], run: walkAct(walk("rei")) });
  assert.equal(other.duplicate, undefined, "a nonce cannot be probed across households");
  assert.equal(pen.rows().length, 2);
});

test("an act that writes two rows keeps its key on the first only; a say inside the scope keeps none", async () => {
  setEnv(RECORD_ON);
  const pen = installActsPen();
  await keyed({ run: async () => {
    await appendJournal(null, walk());
    await appendJournal(null, walk("caelan", "the-town/the-snug"));
    return { ok: true };
  } });
  await keyed({ nonce: "k-say", run: async () => {
    await appendJournal(null, { crossing: currentCrossing(), actor: "caelan", action: "say", cls: "voice", payload: { text: "hello" } });
    return { ok: true };
  } });
  assert.deepEqual(pen.rows().map((r) => [r.action, r.nonce ?? null]), [["walk", "walk:k1"], ["walk", null], ["say", null]]);
});

test("an act that writes no row lands and says the key was not kept; its retry acts again", async () => {
  setEnv(RECORD_ON); runs = 0;
  installActsPen();
  const none = async () => { runs += 1; return { drafted: true }; };
  const a = await keyed({ run: none });
  assert.equal(a.disclosure.nonce_honoured, false);
  assert.equal(a.disclosure.nonce_note, WORLD_NONCE_NOT_KEPT.unwritten);
  const b = await keyed({ run: none });
  assert.equal(b.duplicate, undefined);
  assert.equal(runs, 2);
});

test("a store without 027: the act lands, the INSERT names no nonce column, and the answer says so", async () => {
  setEnv(RECORD_ON);
  const pen = installActsPen();
  const r = await keyed({ kept: false });
  assert.equal(r.disclosure.nonce_honoured, false);
  assert.equal(r.disclosure.nonce_note, WORLD_NONCE_NOT_KEPT.store);
  const insert = pen.asked().find((q) => /^INSERT INTO acts/i.test(q));
  assert.ok(!/nonce/i.test(insert), `the INSERT named a column the store lacks: ${insert}`);
});

test("a bounce the act returns spends no key and gets no disclosure; the retry acts", async () => {
  setEnv(RECORD_ON); runs = 0;
  const pen = installActsPen();
  const bounced = await keyed({ run: async () => { runs += 1; return { error: "bounce", code: 422, defect: "no" }; } });
  assert.equal(bounced.disclosure, null);
  const landed = await keyed();
  assert.equal(landed.duplicate, undefined);
  assert.equal(pen.rows().length, 1);
});

test("two calls in flight in one office: the handler runs once and the second gets the first act's receipt", async () => {
  setEnv(RECORD_ON); runs = 0;
  const pen = installActsPen();
  const [a, b] = await Promise.all([keyed(), keyed()]);
  assert.equal(runs, 1);
  assert.equal(pen.rows().length, 1);
  assert.equal(a.result.walked, true);
  assert.equal(b.duplicate.in_flight, true);
  assert.equal(b.duplicate.act.id, String(pen.rows()[0].id));
});

test("the door's bound is the paper door's: empty and over-long keys are refused, not trimmed", () => {
  assert.ok(nonceDefect(""));
  assert.ok(nonceDefect(7));
  assert.match(nonceDefect("x".repeat(201)).defect, /under 200 bytes/);
  assert.equal(nonceDefect("k1"), null);
});

// ── the real-Postgres half ──────────────────────────────────────────────────

const store = await startStore({ db: "world_act_nonce" });
after(async () => { if (!store.skip) await store.stop(); });

async function withPool(fn) {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: store.url("office_api") });
  setEnv(RECORD_ON);
  __setPoolForTest(pool);
  try { return await fn(pool); } finally { __setPoolForTest(null); await pool.end(); }
}
const owner = async (sql, params = []) => {
  const c = await store.connect("world2_owner");
  try { return await c.query(sql, params); } finally { await c.end(); }
};

test("052 stands on a real store: partial, unique, and not over says", { skip: store.skip }, async () => {
  const { rows: [ix] } = await owner("SELECT indexdef FROM pg_indexes WHERE indexname = 'acts_world_nonce_once'");
  assert.match(ix.indexdef, /UNIQUE/);
  assert.match(ix.indexdef, /COALESCE\(household, ''::text\)/);
  assert.match(ix.indexdef, /WHERE \(\(nonce IS NOT NULL\) AND \(action <> 'say'::text\)\)/);
  await owner("TRUNCATE acts");
  const ins = (action, household = null) => owner(
    "INSERT INTO acts (at, crossing, actor, action, class, household, nonce) VALUES (now(), 1, 'caelan', $1, 'move', $2, 'n')",
    [action, household]);
  await ins("say"); await ins("say");                       // 027's ruling: a say's key is not unique
  await ins("walk");
  await assert.rejects(ins("walk"), (e) => e.code === "23505", "a NULL household is guarded too (COALESCE)");
  await ins("walk", "hh:a");
  await assert.rejects(ins("walk", "hh:a"), (e) => e.code === "23505");
  await ins("enter", "hh:a");                                // another action, another act
});

test("a repeat on a real store writes one row and answers the same act", { skip: store.skip }, async () => {
  await owner("TRUNCATE acts");
  await withPool(async () => {
    runs = 0;
    const first = await keyed({ nonce: "real-1" });
    const again = await keyed({ nonce: "real-1" });
    assert.equal(runs, 1);
    assert.equal(again.duplicate.act.id, String(first.result.act_id));
    await keyed({ nonce: "real-2" });
  });
  const { rows } = await owner("SELECT nonce FROM acts ORDER BY id");
  assert.deepEqual(rows.map((r) => r.nonce), ["walk:real-1", "walk:real-2"]);
});

test("two offices race past the lookup: the store keeps the first, and the second's 23505 answers its receipt", { skip: store.skip }, async () => {
  await owner("TRUNCATE acts");
  await withPool(async () => {
    // Two different in-flight slots (two offices share no memory), one key,
    // one resident. Each handler waits until BOTH lookups have missed.
    let release; const gate = new Promise((r) => { release = r; });
    let waiting = 0;
    const racing = () => async () => { if (++waiting === 2) release(); await gate; return { walked: true, act_id: (await appendJournal(null, walk())).actId }; };
    const [a, b] = await Promise.all([
      keyed({ nonce: "race", actors: ["caelan"], run: racing() }),
      keyed({ nonce: "race", actors: ["caelan", "caelan-twin"], run: racing() }),
    ]);
    const won = [a, b].find((x) => x.result);
    const lost = [a, b].find((x) => x.duplicate);
    assert.ok(won && lost, `expected one act and one receipt: ${JSON.stringify([a, b]).slice(0, 400)}`);
    assert.match(lost.duplicate.note, /raced yours to the record/);
    assert.equal(lost.duplicate.act.id, String(won.result.act_id));
  });
  const { rows } = await owner("SELECT count(*)::int AS n FROM acts");
  assert.equal(rows[0].n, 1, "the loser's transaction rolled back");
});
