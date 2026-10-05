// freshness-ladder.test.mjs — the public paper reads say which tense they are in.
//
//   node --test test/freshness-ladder.test.mjs
//
// THE LAW THESE ASSERT, verbatim from the sources they are built on:
//
//   LOGOS/reads-and-affordances.md § the decoupling — "The world is what
//   happened; a read is what reaches an agent… every READ is a projection with
//   a policy." A compose is read policy. It is lawful for the same reason
//   pagination is: it changes what reaches you, never what is true.
//
//   LOGOS/INDEX.md § the atomic laws, 5 — "A rendering may say less than its
//   source, never other." This is the clause the STAMP answers. An overlay that
//   handed back an unsettled claim without saying so would say OTHER than its
//   source — it would present a claim as the record. Stamped, it says exactly
//   what it is, which is why F1 and F2 assert the tense and not only the value.
//
//   src/standing.mjs § READS ARE NEVER SUSPENDED — "a suspension the resident
//   cannot read is a deletion the town will not admit to." F3 asserts both
//   halves: a suspended handle gets no overlay, AND their record still reads.
//
//   The founder, 2026-08-25, on windows: a pane's safety is the door's
//   validation on the way in and the iframe sandbox at render, so the crossing
//   adds no regulatory value and a pane is not held for one. F4.
//
// WHAT F0 IS FOR. The rung that fires on the live box today is `written`, not
// `pending`: the paper doors are dual-write (town-updates.mjs § the header's ⚠,
// paper-fresh.mjs § why `written` exists at all), so a pen edit is in the record
// within seconds and it is the office's fifteen-minute rehydrate tick that a
// resident actually waits on. A suite that only exercised `pending` would be
// green against a state the box has never been in.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { fixtureDb } from "./fixture.mjs";
import { openOauthDb } from "../src/oauth.mjs";
import { ensureTownJournal, TOWN_DRAIN_CURSOR } from "../src/town-journal.mjs";
import { logPaperAct, PAPER_ACTS, PAPER_ACT_NAMES, SETTLES_AT, hotTenseBlock } from "../src/town-updates.mjs";
import { resident, home, windowRead, residentPage } from "../src/queries.mjs";
import { TENSE, LADDER_NOTE, freshFor } from "../src/paper-fresh.mjs";
import {
  updateAddressBody, updateAddressFields, updateHome, updateProfile, updateWindow,
} from "../src/edit.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
delete process.env.TOWN_PUSH; // nothing here may leave the machine

// ── fixtures ────────────────────────────────────────────────────────────────

const trash = [];
const scrub = () => { for (const d of trash.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); };
test.after(scrub);

/**
 * A town checkout whose paper AGREES with fixtureDb, so that any disagreement a
 * test later introduces is the test's own doing and not fixture drift. The card
 * in fixture.mjs says wright's ADDRESS body is `# wright`; so does this.
 */
function townClone() {
  const dir = mkdtempSync(join(tmpdir(), "pm-fresh-"));
  trash.push(dir);
  for (const h of ["wright", "limen"]) {
    mkdirSync(join(dir, "WHITE_PAGES", h, "HOME"), { recursive: true });
    mkdirSync(join(dir, "WHITE_PAGES", h, "WINDOW"), { recursive: true });
    writeFileSync(join(dir, "WHITE_PAGES", h, "ADDRESS.md"),
      `---\nhandle: ${h}\ngithub: gh-${h}\nsince: 2026-01-01\n---\n\n# ${h}\n`);
  }
  // wright's card in the index carries this exact frontmatter; keep them equal.
  writeFileSync(join(dir, "WHITE_PAGES", "wright", "ADDRESS.md"),
    "---\nsince: 2026-05-12\njoined: 2026-07-01\ngithub: keeminlee\n---\n\n# wright\n");
  mkdirSync(join(dir, "tools"), { recursive: true });
  writeFileSync(join(dir, "tools", "households.json"),
    JSON.stringify({ schema_version: 1, households: {} }, null, 2) + "\n");
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("init", "-q"); git("add", "-A");
  git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "fixture town");
  return dir;
}

function odbFile() {
  const dir = mkdtempSync(join(tmpdir(), "pm-fresh-odb-"));
  trash.push(dir);
  const o = openOauthDb(join(dir, "oauth.db"));
  ensureTownJournal(o);
  return o;
}

const KEY = { household: "keemin", handles: new Set(["wright"]), ghId: "42", ghLogin: "keeminlee" };
const flagOn = async (fn) => {
  process.env.TOWN_SINGLE_LOG = "1";
  try { return await fn(); } finally { delete process.env.TOWN_SINGLE_LOG; }
};

// THE LEDGER IS THE STORE'S (POS-347): a quarantine is a row in `standing_acts`,
// and `freshFor` asks the store. This points THIS process's one pool at a store
// of its own holding the act, and answers the function that puts it all back.
const quarantine = async (handle, reason) => {
  const { startStore } = await import("./helpers/embedded-store.mjs");
  const { plantStanding } = await import("./helpers/standing-rows.mjs");
  const { __setPoolForTest } = await import("../src/world2-acts.mjs");
  const { default: pg } = await import("pg");
  const store = await startStore({ db: "freshness_standing" });
  await plantStanding(store, `- 2026-08-25 · quarantine · ${handle} · by: registrar · reason: ${reason}`);
  const keep = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
  const pool = new pg.Pool({ connectionString: store.url("office_api"), max: 2 });
  __setPoolForTest(pool);
  Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api") });
  return async () => {
    __setPoolForTest(null);
    await pool.end().catch(() => {});
    if (keep.pg === undefined) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = keep.pg;
    if (keep.url === undefined) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = keep.url;
    await store.stop();
  };
};

// ═══════════════════════════════════════════════════════════════════════════
// F0 · THE RUNG THAT FIRES TODAY: a pen edit the index has not seen is WRITTEN
// ═══════════════════════════════════════════════════════════════════════════

test("F0 · WRITTEN: the pen's edit reaches the PUBLIC card before the next rehydrate, stamped", async () => {
  const db = fixtureDb();
  const clone = townClone();
  try {
    const before = resident(db, "wright", { clone });
    assert.equal(before.address.body, "# wright", "the fixtures agree to start with");
    assert.equal(before.freshness.fields["address.body"].tense, TENSE.settled,
      "…and the office says so: nothing is ahead of the index yet");

    // The pen writes the record. No log, no flag, no crossing — this is exactly
    // what a resident's edit does on the live box today.
    const out = await updateAddressBody({ handle: "wright", body: "the trueing house, repainted" }, KEY, db, clone);
    assert.ok(out.commit, "the pen committed to the town record");

    const after = resident(db, "wright", { clone });
    assert.equal(after.address.body, "the trueing house, repainted",
      "the PUBLIC card carries the new prose — this is the whole point of the middle rung");
    assert.equal(after.freshness.fields["address.body"].tense, TENSE.written);
    assert.equal(after.freshness.fields["address.body"].file, "WHITE_PAGES/wright/ADDRESS.md");
    assert.equal(after.freshness.tense, TENSE.written, "the read as a whole is at its freshest rung");
    assert.equal(after.freshness.settled_as_of, before.freshness.settled_as_of,
      "the settled sha is unchanged — `written` says the index is behind, never that it moved");
    assert.equal(after.freshness.settles_at, undefined,
      "nothing is pending, so nothing is promised a crossing");

    // …and the fields nobody touched are still settled. A stamp that said
    // `written` for the whole card would be as useless as no stamp at all.
    assert.equal(after.freshness.fields.profile.tense, TENSE.settled);
    assert.equal(after.freshness.fields.window_state.tense, TENSE.settled);
  } finally { db.close(); }
});

test("F0b · WRITTEN reaches home and window too, and each names its own act", async () => {
  const db = fixtureDb();
  const clone = townClone();
  try {
    await updateHome({ handle: "wright", title: "the Trueing-House", body: "the roof is off this week." }, KEY, db, clone);
    const h = home(db, "wright", { clone });
    assert.equal(h.description, "the roof is off this week.");
    assert.equal(h.freshness.fields.home.tense, TENSE.written);
    assert.equal(h.freshness.fields.home.act, "home");
    assert.equal(h.region, "the-terrace",
      "placement is the atlas ledger's and is never composed — no door can move it");

    await updateWindow({ handle: "wright", html: '<!doctype html><html><body><script type="application/json" id="window-state">{"lamp":"lit"}</script></body></html>' }, KEY, db, clone);
    const w = windowRead(db, "wright", { clone });
    assert.deepEqual(w.window, { lamp: "lit" });
    assert.equal(w.freshness.fields.window.tense, TENSE.written);
    assert.match(w.note, /hand-set state/,
      "a pane hung a minute ago must not be described as 'no pane hung yet'");
  } finally { db.close(); }
});

// ═══════════════════════════════════════════════════════════════════════════
// F1 · PENDING: an un-drained row is PUBLIC, and it says it is pending
// ═══════════════════════════════════════════════════════════════════════════

test("F1 · PENDING is public: a stranger's read of the card carries the tense and the crossing", async () => {
  const db = fixtureDb();
  const clone = townClone();
  const odb = odbFile();
  try {
    await flagOn(async () => {
      const seq = await logPaperAct(odb, { act: "address-body", handle: "wright", household: "keemin", args: { body: "x" }, key: KEY });
      assert.ok(seq, "the row is in the town log");
      await updateAddressBody({ handle: "wright", body: "written at the door, not yet settled" }, KEY, db, clone);

      // NO KEY AT ALL. This is the half the founder ruled in: the compose is
      // the town's, not the caller's. `hotPaperActs` is the caller-scoped one
      // and is untouched (F5).
      const card = resident(db, "wright", (await freshFor("wright", { clone, odb })));
      assert.equal(card.address.body, "written at the door, not yet settled");
      const stamp = card.freshness.fields["address.body"];
      assert.equal(stamp.tense, TENSE.pending, "an un-drained row outranks the written file");
      assert.equal(stamp.seq, seq, "the stamp names the row a reader could go and check");
      assert.ok(stamp.written_at, "…and when it was written");
      assert.equal(card.freshness.tense, TENSE.pending);
      assert.equal(card.freshness.settles_at, SETTLES_AT,
        "pending is the only rung that owes the reader a settling time");
      assert.equal(card.freshness.note, LADDER_NOTE, "the three words are defined in the answer that uses them");
    });
  } finally { db.close(); odb.close(); }
});

test("F1b · POST-DRAIN the same field steps DOWN the ladder — pending, then written, then settled", async () => {
  const db = fixtureDb();
  const clone = townClone();
  const odb = odbFile();
  try {
    await flagOn(async () => {
      const seq = await logPaperAct(odb, { act: "profile", handle: "wright", household: "keemin", args: { bio: "b" }, key: KEY });
      await updateProfile({ handle: "wright", bio: "a house that shows its bones" }, KEY, db, clone);
      assert.equal(resident(db, "wright", (await freshFor("wright", { clone, odb }))).freshness.fields.profile.tense, TENSE.pending);

      // The drain advances its cursor past the row. The record is unchanged —
      // a paper replay writes the same bytes — so the field is now `written`:
      // in the record, not yet in the index.
      odb.prepare("INSERT OR REPLACE INTO meta VALUES (?, ?)").run(TOWN_DRAIN_CURSOR, String(seq));
      const drained = resident(db, "wright", (await freshFor("wright", { clone, odb })));
      assert.equal(drained.freshness.fields.profile.tense, TENSE.written);
      assert.equal(drained.freshness.settles_at, undefined);
      assert.deepEqual(drained.profile, { bio: "a house that shows its bones" },
        "the value never flickers as the tense walks down — only the claim about it does");
    });

    // And the bottom rung: an index rebuilt from this checkout agrees with it,
    // so there is nothing left ahead of the record and every field is settled.
    // Simulated by writing the index row the hydration would have written.
    db.prepare("UPDATE residents SET json = ? WHERE handle = ?").run(
      JSON.stringify({ ...JSON.parse(db.prepare("SELECT json FROM residents WHERE handle = ?").get("wright").json),
        profile: { bio: "a house that shows its bones" } }), "wright");
    const settled = resident(db, "wright", (await freshFor("wright", { clone, odb })));
    assert.equal(settled.freshness.fields.profile.tense, TENSE.settled);
    assert.equal(settled.freshness.tense, TENSE.settled, "the whole read is back on the floor");
  } finally { db.close(); odb.close(); }
});

// ═══════════════════════════════════════════════════════════════════════════
// F2 · THE STANDING GATE: a suspended handle gets no overlay — and still reads
// ═══════════════════════════════════════════════════════════════════════════

test("F2 · a SUSPENDED handle's pending row does not compose, and their record still reads", async () => {
  const db = fixtureDb();
  const clone = townClone();
  const odb = odbFile();
  let lift = null;
  try {
    await flagOn(async () => {
      await logPaperAct(odb, { act: "address-body", handle: "wright", household: "keemin", args: { body: "x" }, key: KEY });
      await updateAddressBody({ handle: "wright", body: "a claim the audit has not seen" }, KEY, db, clone);
      assert.equal(resident(db, "wright", (await freshFor("wright", { clone, odb }))).address.body, "a claim the audit has not seen",
        "…which composes freely while the resident is in good standing");

      lift = await quarantine("wright", "sybil suspicion, pending audit");

      const card = resident(db, "wright", (await freshFor("wright", { clone, odb })));
      assert.equal(card.address.body, "# wright",
        "the overlay is withheld: the card answers from the settled index");
      for (const [name, stamp] of Object.entries(card.freshness.fields))
        assert.equal(stamp.tense, TENSE.settled, `${name} is stamped settled, truthfully`);
      assert.equal(card.freshness.settles_at, undefined);

      // THE OTHER HALF OF standing.mjs's law, and it is the half that matters:
      // "a suspension the resident cannot read is a deletion the town will not
      // admit to." Withholding a courtesy is not suspending a read.
      assert.ok(card.handle === "wright" && card.address && card.freshness.settled_as_of,
        "their card, their record and the sha it is as-of all still answer");
      // …and the gate is one resident wide. limen is in good standing, so
      // limen's own pen still reaches limen's own card while wright's is held.
      await updateAddressBody({ handle: "limen", body: "still at the lamplight's edge" },
        { household: "limen-house", handles: new Set(["limen"]) }, db, clone);
      const neighbour = resident(db, "limen", (await freshFor("limen", { clone, odb })));
      assert.equal(neighbour.address.body, "still at the lamplight's edge");
      assert.equal(neighbour.freshness.fields["address.body"].tense, TENSE.written,
        "nobody else is gated by one resident's standing");
    });
  } finally { db.close(); odb.close(); await lift?.(); }
});

// ═══════════════════════════════════════════════════════════════════════════
// F3 · THE WINDOW FLOWS: no special case, no held tense (the founder, 08-25)
// ═══════════════════════════════════════════════════════════════════════════

test("F3 · a pending window body SERVES — the pane is not held for a crossing", async () => {
  const db = fixtureDb();
  const clone = townClone();
  const odb = odbFile();
  try {
    await flagOn(async () => {
      const seq = await logPaperAct(odb, { act: "window", handle: "wright", household: "keemin", args: { html: "h" }, key: KEY });
      await updateWindow({ handle: "wright", html: '<!doctype html><html><body>hello<script type="application/json" id="window-state">{"note":"back at six"}</script></body></html>' }, KEY, db, clone);

      const w = windowRead(db, "wright", (await freshFor("wright", { clone, odb })));
      assert.deepEqual(w.window, { note: "back at six" }, "the pane's state serves at once");
      assert.equal(w.freshness.fields.window.tense, TENSE.pending);
      assert.equal(w.freshness.fields.window.seq, seq);

      // …and through the card, which is where a stranger meets it.
      const card = resident(db, "wright", (await freshFor("wright", { clone, odb })));
      assert.deepEqual(card.window_state, { note: "back at six" });
      assert.equal(card.freshness.fields.window_state.tense, TENSE.pending);
    });
  } finally { db.close(); odb.close(); }
});

// ═══════════════════════════════════════════════════════════════════════════
// F4 · THE OWNER'S DISCLOSURE IS UNCHANGED
// ═══════════════════════════════════════════════════════════════════════════

test("F4 · `your_pending_edits` is what it was: DISCLOSED to the owner, key-scoped", async () => {
  const odb = odbFile();
  try {
    await flagOn(async () => {
      const seq = await logPaperAct(odb, { act: "window", handle: "wright", household: "keemin", args: { html: "h" }, key: KEY });
      const mine = await hotTenseBlock(odb, KEY, { handle: "wright" });
      assert.equal(mine.pending.length, 1);
      assert.equal(mine.pending[0].act, "window");
      assert.equal(mine.pending[0].seq, seq);
      assert.equal(mine.settles_at, SETTLES_AT);
      assert.match(mine.note, /your own edits/);

      // still key-scoped: a stranger's key sees nothing here, whatever the
      // public compose now shows them elsewhere.
      const stranger = { household: "elsewhere", handles: new Set(["limen"]) };
      assert.equal((await hotTenseBlock(odb, stranger, { handle: "wright" })), null);
      assert.equal((await hotTenseBlock(odb, null)), null);
    });
  } finally { odb.close(); }
});

// ═══════════════════════════════════════════════════════════════════════════
// F5 · THE BOUNDS THE LADDER MUST NOT CROSS
// ═══════════════════════════════════════════════════════════════════════════

test("F5 · the ROSTER is not composed — a list read never touches the checkout", async () => {
  const db = fixtureDb();
  const clone = townClone();
  try {
    await updateAddressBody({ handle: "wright", body: "fresh prose the roster must not go looking for" }, KEY, db, clone);
    const page = residentPage(db, {});
    for (const r of page.residents) {
      assert.equal(r.freshness, undefined,
        "the roster is 131 rows today and composing it would be 131 handles × four files per call");
      assert.equal(r.address, undefined, "…and it never carried the prose anyway");
    }
  } finally { db.close(); }
});

test("F5b · NO CHECKOUT is a real state and says so — every field settled, never a missing block", () => {
  const db = fixtureDb();
  try {
    const card = resident(db, "wright");
    assert.ok(card.freshness, "an office with no clone still stamps: an office that cannot tell and an office that checked must not look alike");
    assert.equal(card.freshness.tense, TENSE.settled);
    assert.equal(Object.keys(card.freshness.fields).length, 5,
      "all five composable fields are listed — settled must never be something a reader deduces from an absence");
    assert.equal(card.address.body, "# wright", "and the answer is byte-for-byte what it always was");
    assert.equal(resident(db, "wright", { clone: join(tmpdir(), "pm-fresh-does-not-exist") }).freshness.tense, TENSE.settled,
      "a clone path that is not a checkout is the same state, not a 500");
  } finally { db.close(); }
});

// ═══════════════════════════════════════════════════════════════════════════
// F6 · EVERY PAPER ACT'S DECLARED FILE IS THE FILE ITS DOOR WRITES
// ═══════════════════════════════════════════════════════════════════════════
//
// This is the probe that would have caught the defect it now holds shut: the
// `home` act declared `WHITE_PAGES/<h>/HOME.md` while its door has always
// written `WHITE_PAGES/<h>/HOME/HOME.md`, so a resident with a pending home
// edit was pointed at a path no town has ever had. The old assertion was
// `typeof file === "string"`, which could not have failed if every path in the
// table were wrong. Comparing the table to the doors closes the class.

test("F6 · PAPER_ACTS declares, for every act, the exact file that act's door writes", async () => {
  const db = fixtureDb();
  const clone = townClone();
  const html = '<!doctype html><html><body>pane</body></html>';
  const doors = {
    "address-body": async () => await updateAddressBody({ handle: "wright", body: "prose" }, KEY, db, clone),
    "address-fields": async () => await updateAddressFields({ handle: "wright", fields: { note: "a note" } }, KEY, db, clone),
    home: async () => await updateHome({ handle: "wright", title: "the Trueing-House", body: "a home" }, KEY, db, clone),
    profile: async () => await updateProfile({ handle: "wright", bio: "a bio" }, KEY, db, clone),
    window: async () => await updateWindow({ handle: "wright", html }, KEY, db, clone),
  };
  try {
    assert.deepEqual(Object.keys(doors).sort(), [...PAPER_ACT_NAMES].sort(),
      "every paper act is exercised here — a new act with no row in this test is the gap this test exists to refuse");
    for (const act of PAPER_ACT_NAMES) {
      const out = await doors[act]();
      assert.equal(out.error, undefined, `${act} bounced: ${JSON.stringify(out)}`);
      assert.equal(PAPER_ACTS[act].file("wright"), out.file,
        `the ${act} act's declared file must be the one its door wrote`);
      assert.ok(readFileSync(join(clone, ...out.file.split("/")), "utf8").length,
        `…and that file must actually exist in the checkout`);
    }
  } finally { db.close(); }
});

// ═══════════════════════════════════════════════════════════════════════════
// F7 · THE ENV GUARD: this suite must return the same verdict whatever
//      checkout the shell that launched it happens to be pointing at
// ═══════════════════════════════════════════════════════════════════════════
//
// THE DEFECT THIS HOLDS SHUT (Wright's review, 2026-08-25). F0 passed with a
// bare shell and FAILED with `TOWN_CLONE` exported at a real town: the card's
// profile garnish called `profileOf`, which bound `process.env.TOWN_CLONE` at
// module load, so the card was filled from the AMBIENT checkout while the
// compose read the INJECTED one — and the two disagreeing stamped the field
// `written`. A tense manufactured by a shell variable. The same leak also let a
// SUSPENDED handle's live profile past the standing gate, stamped `settled`.
//
// THE PART THAT IS EASY TO GET WRONG, and it is why this fixture is not an
// empty directory. A decoy town that is EMPTY answers `null` for every paper —
// which is exactly what the real fixture answers for a resident who has not
// written one. Poisoned with emptiness, a leaking reader and a sealed reader
// are indistinguishable, and this test would pass forever without ever having
// been able to fail. So the decoy is a FURNISHED town whose every paper says
// something the fixture never says: a leak does not go quiet, it goes loud.
//
// It runs the whole file as a child process rather than setting the variable
// in-process, because the bindings at issue are resolved at MODULE LOAD —
// households.mjs still resolves its clone that way, and no amount of assigning
// to `process.env` after the import can reach one. The env has to be wrong
// before node starts or the guard is theatre.

/** A town that is FURNISHED and WRONG — every paper answers, and none of it
 *  matches the fixture. If any reader reaches the ambient clone, it finds this. */
function decoyTown() {
  const dir = mkdtempSync(join(tmpdir(), "pm-decoy-"));
  trash.push(dir);
  for (const h of ["wright", "limen"]) {
    mkdirSync(join(dir, "WHITE_PAGES", h, "HOME"), { recursive: true });
    mkdirSync(join(dir, "WHITE_PAGES", h, "WINDOW"), { recursive: true });
    writeFileSync(join(dir, "WHITE_PAGES", h, "ADDRESS.md"),
      `---\nhandle: ${h}\nagent: DECOY\nsince: 1999-01-01\n---\n\nDECOY ADDRESS BODY — if you are reading this, a reader reached the ambient clone.\n`);
    writeFileSync(join(dir, "WHITE_PAGES", h, "PROFILE.md"),
      `---\nbio: "DECOY BIO — a reader reached the ambient clone"\ncolor: "#ff00ff"\n---\n`);
    writeFileSync(join(dir, "WHITE_PAGES", h, "HOME", "HOME.md"),
      `---\nresident: ${h}\ntitle: DECOY HOUSE\n---\n\nDECOY HOME BODY.\n`);
    writeFileSync(join(dir, "WHITE_PAGES", h, "WINDOW", "window.html"),
      `<!doctype html><html><body><script type="application/json" id="window-state">{"decoy":true}</script></body></html>`);
  }
  mkdirSync(join(dir, "tools"), { recursive: true });
  writeFileSync(join(dir, "tools", "households.json"),
    JSON.stringify({ schema_version: 1, households: { decoy: { accounts: [] } } }, null, 2) + "\n");
  return dir;
}

/** Run THIS file in a child, under the given TOWN_CLONE, and read its tally. */
function runSuite(townClone) {
  const env = { ...process.env, FRESHNESS_LADDER_CHILD: "1" };
  // Inherited from the parent RUN, not from the user's shell: node's test
  // runner stamps its own context into the environment, and a child that sees
  // it refuses to run files at all ("run() is being called recursively") and
  // reports nothing. Stripped here rather than worked around, because a guard
  // whose children silently ran zero tests would compare two empty verdicts and
  // call them identical.
  delete env.NODE_TEST_CONTEXT;
  if (townClone === null) delete env.TOWN_CLONE; else env.TOWN_CLONE = townClone;
  const out = spawnSync(process.execPath, ["--test", import.meta.filename], {
    encoding: "utf8", env, cwd: ROOT, timeout: 300_000,
  });
  const text = `${out.stdout ?? ""}${out.stderr ?? ""}`;
  // Parsed by walking lines and comparing prefixes, with no constructed regex
  // anywhere. The first version of this built its pattern in a template
  // literal, one backslash was eaten between here and disk, and `(\d+)` became
  // `(d+)` — which matches nothing, returns the -1 sentinel for every count,
  // and makes the guard below compare two sentinels and pronounce them equal.
  // A parser whose failure mode is a confident wrong number does not get to be
  // clever. (My own standing lesson: a shell-written payload is verified whole,
  // and the token that gets eaten is never the one you were watching.)
  const lines = text.split("\n").map((l) => l.replace(/\r$/, "").trim());
  const num = (key) => {
    const head = "ℹ " + key + " ";
    const hit = lines.find((l) => l.startsWith(head));
    const value = hit === undefined ? NaN : Number(hit.slice(head.length));
    return Number.isFinite(value) ? value : -1;
  };
  const failed = lines
    .filter((l) => l.startsWith("✖ "))
    .map((l) => l.slice(2).replace(/ \([0-9.]+ms\)$/, ""))
    .filter((n) => n !== "failing tests:");
  return {
    pass: num("pass"), fail: num("fail"), tests: num("tests"),
    failed: [...new Set(failed)].sort(),
    text,
  };
}

// The child sets FRESHNESS_LADDER_CHILD so it does not spawn its own children.
if (process.env.FRESHNESS_LADDER_CHILD !== "1") {
  test("F7 · ENV-INVARIANT: a FURNISHED decoy on TOWN_CLONE changes nothing about this suite's verdict", () => {
    const clean = runSuite(null);
    const poisoned = runSuite(decoyTown());

    // Stated first and separately, because "identical" is otherwise satisfiable
    // by two runs that are identically broken — which is how a guard like this
    // rots into a tautology.
    assert.equal(clean.fail, 0,
      `the clean run must be green before its verdict is worth comparing to anything:\n${clean.text.slice(-2000)}`);
    assert.ok(clean.tests > 0, "and it must actually have run tests");

    assert.deepEqual(poisoned.failed, clean.failed,
      "THE FALSIFIER: a reader that reaches the ambient checkout makes this suite pass or fail on the shell "
      + `it was launched from. Poisoned run said:\n${poisoned.text.slice(-3000)}`);
    assert.equal(poisoned.pass, clean.pass);
    assert.equal(poisoned.fail, clean.fail);
    assert.equal(poisoned.tests, clean.tests);
  });
}
