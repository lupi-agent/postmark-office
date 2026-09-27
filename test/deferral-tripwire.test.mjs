// deferral-tripwire.test.mjs — the cursor may pass a settled row or a judged
// row, and never a deferred one.
//
//   node --test test/deferral-tripwire.test.mjs
//
// THE INVARIANT. planTownDrain sorts every pending join row into three piles and
// they are three different sentences: `settle` is DRAINED, `skipped` is JUDGED
// AND DONE ("not a settling act", "no handle on the row", "already stands in the
// white pages"), and `waiting` is DEFERRED — the pile the founder's tier line
// created, whose whole meaning is "not yet, and nothing is lost".
//
// Only the third makes a promise, so only the third can be broken, and until
// this file it was broken by construction: runTownDrain advances the cursor to
// `head` — the last PENDING row — whatever pile a row landed in. A deferred row
// was therefore reported as waiting and then walked past forever. That is not
// merely dropping a household; it is dropping one while printing the word that
// says it was kept, and the tier line's deferral says out loud to the resident
// "nothing about your standing expires".
//
// TWO MECHANISMS KEEP THE INVARIANT AND THEY COMPOSE. The gangway FREEZES the
// cursor over the rows it defers (test/gangway-drain.test.mjs, G4-G6). Every
// other deferral REFUSES the crossing here. T4 is the falsifier that proves
// they compose rather than fight.
//
// ── WHY THIS CANNOT FIRE FROM A DOOR TODAY ─────────────────────────────────
//
// The other deferral is the tier line: a row with no verified GitHub id and no
// co-sign. No live door can write one, and T5/T6 assert the two halves of that
// rather than leaving it as a claim in a comment:
//
//   · both join doors carry the identity fence in the same function as their
//     append and above it — declare.mjs § "11 — the anchor" and residency.mjs §
//     requestResidency both throw 403 before any row is written;
//   · and the berth arc opens no window either, because `household do: "begin"`
//     PARKS its declaration on the berth row and writes no journal row at all
//     ("nothing is executed until the click"), while the co-sign runs that
//     parked declaration under the human's just-verified identity — so the row
//     is BORN anchored rather than becoming anchored later.
//
// That is what makes the tripwire cheap rather than pointless: it costs nothing
// on every real crossing, and it is the thing standing between a future door
// that relaxes the fence (or a hand-run migration, or a restored backup — the
// foreign-class tripwire's own stated reasons) and a household eaten in silence.

import "./helpers/drain-pen.mjs"; // #2040: fixtures get a real ledger pen
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { fixtureDb } from "./fixture.mjs";
import { openOauthDb } from "../src/oauth.mjs";
import {
  appendTownJournal, ensureTownJournal, pendingRows, readTownJournal,
  rowIsSettleable, townDrainCursor, SETTLE_THRESHOLD,
} from "../src/town-journal.mjs";
import { runTownDrain, TOWN_DOORS } from "../src/town-bridge.mjs";
import { REGISTRY_PATH } from "../src/residency.mjs";
import { MAIL_ACT } from "../src/town-mail.mjs";
import { outboxRelPath } from "../src/write.mjs";
import { withRecordFrom } from "./registry-pool-stub.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
delete process.env.TOWN_PUSH; // nothing here may leave the machine

// ── fixtures ────────────────────────────────────────────────────────────────

const trash = [];
const tmp = (tag) => { const d = mkdtempSync(join(tmpdir(), `pm-${tag}-`)); trash.push(d); return d; };
const dropAll = () => {
  for (const d of trash.splice(0)) {
    try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* the OS will */ }
  }
};

function townClone({ handles = ["wright", "limen"] } = {}) {
  const dir = tmp("tripwire-town");
  for (const h of handles) {
    mkdirSync(join(dir, "WHITE_PAGES", h, "outbox"), { recursive: true });
    mkdirSync(join(dir, "WHITE_PAGES", h, "inbox"), { recursive: true });
    mkdirSync(join(dir, "WHITE_PAGES", h, "HOME"), { recursive: true });
    writeFileSync(join(dir, "WHITE_PAGES", h, "ADDRESS.md"), `---\nhandle: ${h}\ngithub: gh-${h}\nsince: 2026-01-01\n---\n\n# ${h}\n`);
  }
  mkdirSync(join(dir, "tools"), { recursive: true });
  writeFileSync(join(dir, REGISTRY_PATH), JSON.stringify({ schema_version: 1, households: {} }, null, 2) + "\n");
  writeFileSync(join(dir, "WHITE_PAGES", "mail-ledger.md"), "# the mail ledger\n\n- 2026-07-01 · a-line · someone → someone\n");
  writeFileSync(join(dir, "WHITE_PAGES", "stamp-ledger.md"), "# the stamp ledger\n\n- 2026-08-01 · registry: someone = hh:elsewhere\n");
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("init", "-q"); git("add", "-A");
  git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "fixture town");
  return dir;
}

const setGangway = (clone, state) => {
  mkdirSync(join(clone, "HARBOR"), { recursive: true });
  writeFileSync(join(clone, "HARBOR", "GANGWAY.md"), `# the gangway\n\nstate: ${state}\n\nFounder-edited only.\n`);
};

const liveOdb = () => openOauthDb(join(tmp("tripwire-odb"), "oauth.db"));

/** An ANCHORED join row — what every live door writes. */
const seedAnchored = (o, handle) => appendTownJournal(o, {
  cls: "join", act: "declare-household", household: handle, handle,
  ghId: "777", ghLogin: `${handle}-gh`,
  payload: { household: handle, card: `${handle}'s card.` },
});

/**
 * An UNANCHORED join row — no verified id, no co-sign.
 *
 * Written by hand ON PURPOSE, and the hand is the point: T5 and T6 assert that
 * no door will make one, so the only way to reach the tier line's deferral in a
 * test is to be the migration/restored-backup/relaxed-fence this tripwire
 * exists for. A fixture that could be produced by a door would mean the fence
 * had a hole, which is the other thing this file is watching.
 */
const seedUnanchored = (o, handle) => appendTownJournal(o, {
  cls: "join", act: "declare-household", household: handle, handle,
  ghId: null, ghLogin: null, cosignedGhId: null,
  payload: { household: handle, card: `${handle}'s card.` },
});

const seedLetter = (o, { from = "wright", to = "limen", date = "2026-08-24", slug = "a-fine-hat" } = {}) =>
  appendTownJournal(o, {
    cls: "letter", act: MAIL_ACT, household: "keemin", handle: from,
    ghId: "42", ghLogin: "keeminlee",
    payload: {
      args: { from, to, title: "a fine hat", thread: "new", body: `${to} —\n\nA letter.` },
      id: `${from}-${date}-to-${to}-${slug}`, file: outboxRelPath(from, date, to, slug),
    },
  });

const db = fixtureDb();
/** The threshold sentences carry em-dashes and parentheses; match them literally. */
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// POINTED AT THE RECORD, AND AWAITED (POS-158). A crossing reads the town's
// registry from the store and writes its membership rows there, so the helper
// seeds the store from whatever registry the clone already holds — the same
// fixture these tests were already writing — and awaits the drain. Without it
// every crossing here would answer "the record is unreachable" and defer every
// row, which is correct behaviour answering the wrong question.
const run = (o, over = {}) => withRecordFrom(over.clone, () => runTownDrain(o, { db, doors: TOWN_DOORS, lockHeld: () => true, log: () => {}, ...over }));
// ASYNC-AWARE SINCE POS-158. `return fn()` handed back a promise and the
// `finally` then cleared the flag while the work was still running — a teardown
// racing the thing it tears down, which fails somewhere else entirely.
const flagOn = async (fn) => {
  process.env.TOWN_SINGLE_LOG = "1";
  try { return await fn(); } finally { delete process.env.TOWN_SINGLE_LOG; }
};
const ashore = (clone, h) => existsSync(join(clone, "WHITE_PAGES", h, "ADDRESS.md"));

test.after(dropAll);

// ═══════════════════════════════════════════════════════════════════════════
// T1-T4 · THE TRIPWIRE
// ═══════════════════════════════════════════════════════════════════════════

test("T1 · A DEFERRED ROW STOPS THE CROSSING: nothing written, cursor unmoved, row still there", async () => {
  const clone = townClone();
  const o = liveOdb();
  try {
    await flagOn(async () => {
      const seq = seedUnanchored(o, "unanchored");

      const r = await run(o, { clone, date: "2026-08-24" });

      assert.equal(r.ran, false);
      assert.equal(r.refused, "deferred-rows");
      assert.equal(townDrainCursor(o), 0, "the cursor did not move");
      assert.equal(pendingRows(o).length, 1, "and the row is still in the log — which is what `waiting` promised");
      assert.equal(ashore(clone, "unanchored"), false, "nothing was written");

      // The refusal NAMES the row and says what it is protecting, because a
      // tripwire an operator cannot act on is an outage with extra steps. This
      // refusal stops the crossing and therefore the mail, so its one line is
      // the whole briefing: WHICH rows, and WHY each one was deferred.
      assert.match(r.skipped, new RegExp(`${seq}:unanchored`), "the row is named by seq and handle");
      assert.ok(r.skipped.includes(SETTLE_THRESHOLD),
        "…and the REASON it was deferred for, VERBATIM — an operator woken by a refused crossing "
        + "should not have to go spelunking, and a paraphrase would be debugging a different town");
      assert.match(r.skipped, new RegExp(`${seq}:unanchored — `),
        "reason attached TO its row, not floating loose at the end where two rows' reasons would be unattributable");
      assert.match(r.skipped, /never be read again/);
      assert.match(r.skipped, /Nothing was written and the cursor did not move/);
      assert.match(r.skipped, /A deferral the cursor does not honour is a row dropped under a sentence promising it was kept/);

      // and the whole plan rides out, so the operator sees the crossing, not
      // just the thing that stopped it
      assert.deepEqual(r.waiting.map((w) => w.handle), ["unanchored"]);
      assert.equal(r.waiting[0].why, SETTLE_THRESHOLD, "the tier line's own stated threshold, unparaphrased");

      // …and a --dry-run gets the same answer, because "it would refuse" IS
      // what this crossing would do — with the dry-run marker still on it.
      const dry = await run(o, { clone, date: "2026-08-24", dryRun: true });
      assert.equal(dry.refused, "deferred-rows");
      assert.equal(dry.dry_run, true);
      assert.deepEqual(dry.waiting.map((w) => w.handle), ["unanchored"]);
      assert.equal(townDrainCursor(o), 0);
    });
  } finally { o.close(); }
});

test("T1b · EVERY deferred row is named, each with its OWN reason beside it", async () => {
  const clone = townClone();
  const o = liveOdb();
  try {
    await flagOn(async () => {
      const first = seedUnanchored(o, "first-adrift");
      const second = seedUnanchored(o, "second-adrift");

      const r = await run(o, { clone, date: "2026-08-24" });

      assert.equal(r.refused, "deferred-rows");
      assert.match(r.skipped, /defers 2 row\(s\)/, "the count is the count");

      // Both rows, each with its reason ATTACHED to it. One reason printed once
      // at the end would be a briefing an operator has to guess the shape of the
      // moment two rows are deferred for different causes.
      assert.match(r.skipped, new RegExp(`${first}:first-adrift — ${escapeRe(SETTLE_THRESHOLD)}`));
      assert.match(r.skipped, new RegExp(`${second}:second-adrift — ${escapeRe(SETTLE_THRESHOLD)}`));

      assert.equal(townDrainCursor(o), 0);
      assert.equal(pendingRows(o).length, 2, "and both are still in the log");
    });
  } finally { o.close(); }
});

test("T2 · THE FLIP: the same crossing with the row ANCHORED settles it and advances the cursor", async () => {
  const clone = townClone();
  const o = liveOdb();
  try {
    await flagOn(async () => {
      const seq = seedAnchored(o, "anchored");

      const r = await run(o, { clone, date: "2026-08-24" });

      assert.equal(r.refused, undefined, "an anchored row is not deferred, so there is nothing to refuse");
      assert.deepEqual(r.settled, ["anchored"]);
      assert.equal(ashore(clone, "anchored"), true);
      assert.equal(townDrainCursor(o), seq, "and the cursor advances, as it always did");
      assert.deepEqual(pendingRows(o), []);
    });
  } finally { o.close(); }
});

test("T3 · A JUDGED ROW IS NOT A DEFERRED ONE — `skipped` still passes the cursor", async () => {
  const clone = townClone();
  const o = liveOdb();
  try {
    await flagOn(async () => {
      // "already stands in the white pages" — a decision, not a deferral. The
      // tripwire must not confuse the two, or every re-run of a settled join
      // would halt the ferry.
      const seq = seedAnchored(o, "wright"); // wright is already ashore in the fixture

      const r = await run(o, { clone, date: "2026-08-24" });

      assert.equal(r.refused, undefined, "judged and done is a fine thing to walk past");
      assert.deepEqual(r.settled, []);
      assert.equal(r.skipped_rows.length, 1);
      assert.match(r.skipped_rows[0].why, /already stands in the white pages/);
      assert.equal(townDrainCursor(o), seq, "the cursor advances past a row that was judged");
      assert.deepEqual(pendingRows(o), []);
    });
  } finally { o.close(); }
});

test("T4 · IT COMPOSES WITH THE GANGWAY: a frozen crossing defers and does NOT refuse", async () => {
  const clone = townClone();
  const o = liveOdb();
  try {
    await flagOn(async () => {
      seedAnchored(o, "newcomer");
      seedLetter(o);
      setGangway(clone, "frozen");

      const r = await run(o, { clone, date: "2026-08-24" });

      // The gangway defers its rows too — but it keeps the promise the stronger
      // way, by freezing the cursor. Refusing here would stop the town's mail
      // for a breaker designed to let mail through.
      assert.equal(r.refused, undefined, "the gangway is exempt: its deferral is already honoured");
      assert.equal(r.ran, true);
      assert.equal(r.gangway_held, 1);
      assert.equal(townDrainCursor(o), 0, "the cursor is frozen, so nothing is stranded");
      assert.equal(pendingRows(o).length, 2, "every row is still here");
      assert.equal(r.letters.length, 1);
      assert.equal(r.letters[0].skipped, undefined, "and the mail still sails, which is the whole point of the exemption");
    });
  } finally { o.close(); }
});

test("T4b · …and a frozen gangway covers a tier-line row too: held, not stranded", async () => {
  const clone = townClone();
  const o = liveOdb();
  try {
    await flagOn(async () => {
      // The exemption is "the gangway is holding the cursor", not "the gangway
      // is up". A frozen gangway freezes the cursor, so an unanchored row on
      // that crossing is NOT stranded — it is held with everything else.
      seedUnanchored(o, "unanchored");
      setGangway(clone, "frozen");

      const r = await run(o, { clone, date: "2026-08-24" });

      assert.equal(r.refused, undefined,
        "a frozen gangway holds every join row including this one — the cursor is frozen, so nothing is lost");
      assert.equal(townDrainCursor(o), 0);
      assert.equal(pendingRows(o).length, 1, "and the row survives, which is all the invariant asks");
    });
  } finally { o.close(); }
});

// ═══════════════════════════════════════════════════════════════════════════
// T5-T6 · WHY IT CANNOT FIRE FROM A DOOR — the fence, asserted not claimed
// ═══════════════════════════════════════════════════════════════════════════

test("T5 · THE IDENTITY FENCE: neither join door will append a row without a verified id", async () => {
  const work = tmp("tripwire-srv");
  const clone = townClone();
  let child;
  try {
    const dbPath = join(work, "fixture.db");
    fixtureDb(dbPath).close();
    const odbPath = join(work, "oauth.db");
    openOauthDb(odbPath).close();

    const PORT = 43921;
    const BASE = `http://127.0.0.1:${PORT}`;
    const STATIC = "statickey";
    child = spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", String(PORT), "--db", dbPath, "--oauth-db", odbPath], {
      env: {
        ...process.env, TOWN_SINGLE_LOG: "1", OFFICE_KEYS: `${STATIC}=keemin:wright`,
        TOWN_CLONE: clone, WORLD_CLONE: join(work, "no-world"), VOICES_LOG: join(work, "voices.jsonl"), TOWN_PUSH: "",
        // so the pen check passes and the IDENTITY fence is what answers — the
        // door bounces "not-yet-open" first otherwise, which would make this
        // falsifier pass for the wrong reason.
        POSTMARK_PEN_TOKEN: "fixture-pen-token",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise((ok, no) => {
      const t = setTimeout(() => no(new Error("server never listened")), 15_000);
      child.stdout.on("data", (d) => { if (String(d).includes("listening")) { clearTimeout(t); ok(); } });
      child.on("exit", (c) => no(new Error(`server exited early (${c})`)));
    });

    const rows = () => {
      const o = openOauthDb(odbPath);
      try { ensureTownJournal(o); return readTownJournal(o); } finally { o.close(); }
    };
    const rpc = (name, args, key) => fetch(`${BASE}/mcp`, {
      method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    }).then((r) => r.json()).then((j) => j.result?.content?.[0]?.text ?? "");

    // A BERTH: boards with nothing — no GitHub, no human in the loop.
    const berth = await (await fetch(`${BASE}/berth`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: "driftwood" }),
    })).json();
    assert.ok(berth.key?.startsWith("pmb_"), "a berth key, which carries no GitHub identity");

    for (const [verb, args] of [
      ["declare_household", { household: "Driftwood House", handle: "driftwood", card: "a card" }],
      ["request_residency", { handle: "driftwood", card: "a card" }],
    ]) {
      const out = await rpc(verb, args, berth.key);
      assert.match(out, /GitHub-verified sign-in/, `${verb} refuses a berth key by the identity fence`);
    }

    // A STATIC SHELL KEY: a household and handles, and no GitHub identity.
    assert.match(await rpc("declare_household", { household: "Static House", handle: "statichouse", card: "a card" }, STATIC),
      /GitHub-verified sign-in/, "and refuses a static key the same way");

    assert.deepEqual(rows(), [],
      "zero rows written by any of it — the fence is in the same function as the append, and above it");
  } finally {
    if (child && child.exitCode === null) {
      const gone = new Promise((ok) => child.on("exit", ok));
      child.kill();
      await gone; // Windows: the db stays locked until the child is truly down
    }
    rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("T6 · THE BERTH ARC OPENS NO WINDOW: `begin` parks a declaration, it does not log an act", async () => {
  const work = tmp("tripwire-begin");
  const clone = townClone();
  let child;
  try {
    const dbPath = join(work, "fixture.db");
    fixtureDb(dbPath).close();
    const odbPath = join(work, "oauth.db");
    openOauthDb(odbPath).close();

    const PORT = 43922;
    const BASE = `http://127.0.0.1:${PORT}`;
    child = spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", String(PORT), "--db", dbPath, "--oauth-db", odbPath], {
      env: {
        ...process.env, TOWN_SINGLE_LOG: "1", OFFICE_KEYS: "unused=keemin:wright",
        TOWN_CLONE: clone, WORLD_CLONE: join(work, "no-world"), VOICES_LOG: join(work, "voices.jsonl"), TOWN_PUSH: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise((ok, no) => {
      const t = setTimeout(() => no(new Error("server never listened")), 15_000);
      child.stdout.on("data", (d) => { if (String(d).includes("listening")) { clearTimeout(t); ok(); } });
      child.on("exit", (c) => no(new Error(`server exited early (${c})`)));
    });

    const rows = () => {
      const o = openOauthDb(odbPath);
      try { ensureTownJournal(o); return readTownJournal(o); } finally { o.close(); }
    };

    const berth = await (await fetch(`${BASE}/berth`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: "driftwood" }),
    })).json();

    const begun = await fetch(`${BASE}/mcp`, {
      method: "POST", headers: { authorization: `Bearer ${berth.key}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "household",
        arguments: { do: "begin", args: { household: "Driftwood House", card: "A first line about me." } } } }),
    }).then((r) => r.json()).then((j) => j.result?.content?.[0]?.text ?? "");

    assert.match(begun, /"did": "begin"/, "the declaration is accepted…");
    assert.deepEqual(rows(), [],
      "…and writes NO journal row. Its own answer says why: 'nothing is executed until the click' — "
      + "the co-sign runs the parked declaration under the human's just-verified identity, so the row is BORN anchored");
  } finally {
    if (child && child.exitCode === null) {
      const gone = new Promise((ok) => child.on("exit", ok));
      child.kill();
      await gone;
    }
    rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("T7 · rowIsSettleable is the whole predicate, and a co-sign satisfies it", () => {
  // The tier line's threshold reads "a verified GitHub identity OR a human
  // co-sign". Nothing in src/ writes `cosigned_gh_id` onto a ROW today — the
  // co-sign lands on the BERTH and the row is written afterwards, anchored by
  // it — so this asserts the predicate rather than a flow, and it is the line
  // a future co-sign-first door would have to satisfy.
  assert.equal(rowIsSettleable({ ghId: "777" }), true);
  assert.equal(rowIsSettleable({ cosignedGhId: "888" }), true);
  assert.equal(rowIsSettleable({ ghId: null, cosignedGhId: null }), false);
  assert.equal(rowIsSettleable({}), false);
  assert.equal(rowIsSettleable(null), false);
});
