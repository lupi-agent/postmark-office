// falsifier-guard-equality.mjs — the guard on the WRITE-PATH GUARD port.
//
// `guard-reads.mjs` is a PORT of the office's own door guards onto `claims` and
// `acts`. Every function it ports forbids a second copy of itself; what stands in
// for the import is the live lane's answer, unchanged:
//
//   RUN BOTH, OVER THE SAME INPUTS, AND NAME EVERY ROW THEY DISAGREE ABOUT.
//
// Every oracle below is 1.0's OWN function, imported live out of this office —
// `liveMarks`, `liveChildrenOf`, `replayDrafts`, `readAttachments`,
// `declareAttachment`, `liveHolder`, `holdingsOf`, `attachmentsFromState`. None
// is re-expressed here.
//
// ── THE EQUALITIES, AND WHAT EACH ONE COULD CATCH ──────────────────────────
//
//   G1 THE LIVE LAYER   1.0's `liveMarks(db, {household})` against
//                       `pgLiveMarks`, over a population written through ONE
//                       `appendJournal` call per declaration — so both pens hold
//                       the same acts BY CONSTRUCTION rather than by arrangement.
//                       Catches: a dropped field, a coerced type, a status the
//                       port counts as live and 1.0 does not.
//   G2 THE THREE SEAMS  the fields that deliberately differ across the flag —
//                       `stamps`↔`stake`, `put_forward`↔`status`,
//                       `household`↔the resolved key. Each is its OWN assertion
//                       rather than an exemption in G1: a seam that is checked is
//                       narrower than a seam that is skipped, and G1's comparison
//                       stays total.
//   G3 THE CHILDREN     1.0's `liveChildrenOf` against `pgLiveChildrenOf`, over
//                       EVERY id in the live layer — the empty answers included,
//                       because the stranding check's whole job is to be empty
//                       correctly.
//   G4 THE OVERLAY      1.0's `replayDrafts` over the journal against
//                       `pgDraftsForKey`, with the SAME canon and 1.0's own
//                       `pathFor`/`filedPathOfAt` injected into both. Catches the
//                       deleted arm, which `claims` cannot answer at all.
//   G5 THE HOLDER FOLD  1.0's `attachmentsFromState` → `declareAttachment` →
//                       `readAttachments` → `liveHolder`/`holdingsOf` — the
//                       recovery chain `dynamic-rebuild.mjs` runs — against
//                       `pgAttachmentsFor` → `pgHolderOf`/`pgHoldingsOf` over
//                       `acts`. The 1.0 store on this box is EMPTY (see the
//                       module's § COVERAGE), so the oracle is rebuilt from the
//                       world repo's own STATE by 1.0's own covenant. That
//                       covenant is exactly the claim under test.
//   G6 THE RLS REFUSAL  that `assertHouseholdDeclared` refuses an undeclared
//                       connection, and — with the owner credential — HOW MANY
//                       draft rows `office_api` cannot see cross-household. This
//                       is what makes `DISCLOSURES.cross_household` a receipt
//                       instead of a claim.
//
// ── EXIT CODES ───────────────────────────────────────────────────────────────
//
//   0  every equality holds
//   1  RED — a divergence, named
//   2  CANNOT RUN
//
// There is no code for "checked nothing and found nothing". Every equality
// reports its own `compared`, and any equality that compared zero exits 2.
//
// ── RUNNING IT ───────────────────────────────────────────────────────────────
//
//   . ~/guards-env.sh                     # the box's credential file, sourced
//   export WORLD2_PG_URL="$W2_READER_URL" # world2_dev, read-only — G5's store
//   export W2_OWNER_URL=…                 # world2_dev owner — G6's hidden count
//   export W2_GUARDS_OWNER_URL="postgres://world2_owner:…@localhost/world2_guards_lane"
//   export W2_GUARDS_URL="postgres://office_api:…@localhost/world2_guards_lane"
//   node world2/tools/falsifier-guard-equality.mjs --world-repo ~/world-full
//
// The scratch database is the brief's: `world2_guards_lane`, created and dropped
// around the run. G1–G4 and G6 write there; NOTHING in this file writes to
// `world2_dev`, which is opened read-only for G5 and for G6's count.
//
// `--json` machine-readable · `--prove-can-fail` breaks each port on purpose, in
// memory, and requires every break to turn this red.

import { resolve, join } from "node:path";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import pg from "pg";

import * as guards from "./guard-reads.mjs";

const arg = (n) => { const i = process.argv.indexOf(n); return i === -1 ? null : process.argv[i + 1]; };
const has = (n) => process.argv.includes(n);
const die = (msg) => { console.error(`CANNOT RUN · ${msg}`); process.exit(2); };

const worldRepo = arg("--world-repo");
if (!worldRepo) die("usage: falsifier-guard-equality.mjs --world-repo <checkout> [--json] [--prove-can-fail]");
const REPO = resolve(worldRepo);
if (!existsSync(join(REPO, "STATE"))) die(`no STATE/ under ${REPO} — G5's oracle is 1.0's attachmentsFromState over it, and a run that skipped G5 would report a green it did not earn`);

for (const v of ["WORLD2_PG_URL", "W2_GUARDS_URL", "W2_GUARDS_OWNER_URL"]) {
  if (!process.env[v]) die(`${v} missing`);
}

// ── the oracles, imported live out of this office ───────────────────────────
//
// THE ENV IS SET BEFORE THE IMPORTS, and that ordering is load-bearing rather
// than tidy: `world2-claims.mjs` reads `WORLD2_PG_URL` when its pool is first
// built, and `world-journal.mjs` decides at every write whether to mirror. The
// scratch database has to be the one those modules reach, or G1 would compare
// 1.0's journal against `world2_dev` and red on every row for the right reason
// and the wrong cause.
const DEV_URL = process.env.WORLD2_PG_URL;
process.env.WORLD2_PG_URL = process.env.W2_GUARDS_URL;
process.env.WORLD2_PG = "1";
process.env.WORLD2_CANDLE = "1";
process.env.WORLD_SINGLE_LOG = "1";

let journalMod, holdMod, entitiesMod, storeMod, rebuildMod, claimsMod;
try {
  journalMod = await import("../../src/world-journal.mjs");
  holdMod = await import("../../src/world-hold.mjs");
  entitiesMod = await import("../../src/dynamic-entities.mjs");
  storeMod = await import("../../src/dynamic-store.mjs");
  rebuildMod = await import("../../tools/dynamic-rebuild.mjs");
  claimsMod = await import("../../src/world2-claims.mjs");
} catch (e) { die(`this office's own modules cannot be imported: ${e.message}`); }

const { appendJournal, normalizeRow, liveMarks, liveChildrenOf, readJournal, replayDrafts, pathFor, CLASS_MARK } = journalMod;
const { liveHolder, holdingsOf } = holdMod;
const { readAttachments, declareAttachment } = entitiesMod;
const { openDynamic } = storeMod;
const { attachmentsFromState } = rebuildMod;
const { withHousehold, docketSettled } = claimsMod;
for (const [n, f] of Object.entries({ appendJournal, normalizeRow, liveMarks, liveChildrenOf, replayDrafts, liveHolder, readAttachments, declareAttachment, attachmentsFromState, withHousehold }))
  if (typeof f !== "function") die(`this office exports no ${n} — the oracle this falsifier judges against is missing`);

// ═════════════════════════════════════════════════════════════════════════════
// THE POPULATION — one appendJournal call per declaration, both pens at once
// ═════════════════════════════════════════════════════════════════════════════
//
// G1–G4 need the two stores to hold THE SAME ACTS. On `world2_dev` they do not
// and cannot: its 851 locked claims are canon (they are rows in `marks`), and
// the lab office's journal holds one row. Comparing those two would be comparing
// two different questions, which is the mistake E2 made in the live lane and
// which is worth not repeating.
//
// So the population is WRITTEN.
//
// ── IT TAKES TWO WRITES NOW, AND THAT IS G1 (POS-156, 2026-09-22) ────────
//
// It used to take ONE: `appendJournal` wrote the sqlite journal row and fanned
// the same row out to the Postgres pens, so a single call filled both sides of
// the A/B and neither side was arranged. G1 deleted that journal INSERT --
// `appendJournal` writes the RECORD and only the record now -- and the one call
// stopped feeding 1.0's arm.
//
// It did not fail loudly. It filled `claims` and left the journal empty, so the
// comparison ran with a full docket against nothing and reported the port
// drawing marks "1.0's overlay does not" -- six findings and, underneath them,
// the line that actually says it: "compared nothing: G1_a, G2_a, G4_a, G1_b,
// G2_b, G4_b -- a green here is unearned".
//
// So the script writes BOTH eras explicitly, because the one function that used
// to write both no longer does. Neither side is arranged any more than it was:
// the store's row is what the live pen makes of the declaration, and the
// journal's row is `normalizeRow`'s -- the office's ONE row shape, imported
// rather than restated, so the two sides cannot drift into disagreeing about
// what a row is.
//
// ⛑ THE JOURNAL WRITE IS THIS FILE'S, and it is not a door's. No pen in the
// office writes that table any more except the arena's (`appendArenaRow`). This
// falsifier writes it because 1.0's live layer IS that table and 1.0's readers
// are the oracle it judges the port against; when those readers go (G2, with
// `liveMarks` and `draftsForKey`), this file goes with them and the two-write
// population goes too.

/** 1.0's arm of the population: one row into the sqlite journal, in the office's own shape. */
const JOURNAL_COLUMNS = "crossing, actor, action, object, at_anchor, at_dx, at_dy, witnesses, class, payload, effect, household, written_at";
function seedJournalRow(db, entry) {
  const row = normalizeRow(entry);
  const res = db.prepare(
    `INSERT INTO journal (${JOURNAL_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.crossing, row.actor, row.action, row.object,
    row.at_anchor, row.at_dx, row.at_dy,
    row.witnesses, row.class, row.payload, row.effect,
    row.household, row.written_at);
  return { seq: Number(res.lastInsertRowid), ...row };
}
//
// The script exercises every branch the four guards actually read:
//
//   · an unstaked leave-mark          → a DRAFT claim  (the private compose)
//   · a staked leave-mark             → a PENDING claim (put_forward's verdict)
//   · an amend of a live draft        → the in-place rewrite, latest-wins
//   · a predicated child              → `parent_id`, which lives in `data`
//   · a parcel                        → the cap guard's own kind
//   · a withdraw of a live draft      → the DELETE arm; gone from both
//   · a withdraw of a PUBLISHED mark  → the arm `claims` cannot answer (G4)
//   · a second household              → the scoping every guard depends on
//
// The published mark for the last one is planted directly in `marks`, because
// only `clearing_job` may materialize one and the candle is not what is on trial.

// ── THE TWO SPELLINGS, WHICH THIS HARNESS MUST HOLD APART ──────────────────
//
// The first run of this falsifier got them wrong and said so loudly, which is
// the reason both names exist here rather than one.
//
// `JOURNAL_HOUSEHOLD` is what `resolvedWorldHousehold(key)` returns — the office
// KEY's household name, which for a one-resident key is the handle. It is what
// `appendJournal` stores, what `liveMarks(db, {household})` scopes by, and what
// `mirrorAct` copies into `acts.household`.
//
// `HOUSEHOLD_KEY` is what `householdKeyFor` resolves that name to through
// `identities` — the RESOLVED key, and what `claims.household` holds.
//
// Feeding the key to `liveMarks` and the name to `pgLiveMarks` would compare two
// different questions and report the port as holding nothing. Feeding both sides
// the key made `householdKeyFor` miss (it is keyed by HANDLE) and write
// `solo:gh:9000001` — a spelling of a spelling. Both happened on run 1, and both
// were the harness rather than the port.
const JOURNAL_HOUSEHOLD = { a: "guards-alfa", b: "guards-bravo" };
// POS-160: the resolved key is the house's SLUG. `householdKeyFor` reads the
// REGISTRY (households + household_pins) rather than `identities`, so the
// scratch seeds both below and they say the same thing — a harness that said it
// one way in one table and another way in another is how a port gets blamed for
// a fixture. The old spelling was `gh:9000001` / `gh:9000002`.
const HOUSEHOLD_SLUG = { a: "guards-alfa-house", b: "guards-bravo-house" };
const HOUSEHOLD_KEY = { a: `hh:${HOUSEHOLD_SLUG.a}`, b: `hh:${HOUSEHOLD_SLUG.b}` };
const HOUSEHOLD_GH_ID = { a: 9000001, b: 9000002 };
const ACTORS = { a: "guards-alfa", b: "guards-bravo" };

const SCRIPT = [
  { who: "a", action: "leave-mark", slug: "the-quiet-shed", payload: { kind: "sited", by: ACTORS.a, slug: "the-quiet-shed", body: "a shed, unstaked and private", at: { x: 40, y: 40 }, extent: { w: 4, h: 4 }, date: "2026-08-28" } },
  { who: "a", action: "leave-mark", slug: "the-loud-shed", payload: { kind: "sited", by: ACTORS.a, slug: "the-loud-shed", body: "a shed with a stake behind it", at: { x: 60, y: 60 }, extent: { w: 4, h: 4 }, date: "2026-08-28", stamps: 3, put_forward: true } },
  { who: "a", action: "amend", slug: "the-quiet-shed", payload: { kind: "sited", by: ACTORS.a, slug: "the-quiet-shed", body: "a shed, rewritten while still private", at: { x: 41, y: 41 }, extent: { w: 4, h: 4 }, date: "2026-08-28", amend: true } },
  { who: "a", action: "leave-mark", slug: "the-shed-door", payload: { kind: "predicated", by: ACTORS.a, slug: "the-shed-door", body: "a door on the quiet shed", parent_id: `${ACTORS.a}/the-quiet-shed`, date: "2026-08-28" } },
  { who: "a", action: "leave-mark", slug: "alfa-ground", payload: { kind: "parcel", by: ACTORS.a, slug: "alfa-ground", body: "ground", at: { x: 100, y: 100 }, extent: { w: 25, h: 25 }, date: "2026-08-28" } },
  { who: "a", action: "leave-mark", slug: "the-doomed-sketch", payload: { kind: "sited", by: ACTORS.a, slug: "the-doomed-sketch", body: "this one gets let go", at: { x: 70, y: 70 }, extent: { w: 2, h: 2 }, date: "2026-08-28" } },
  { who: "a", action: "withdraw", slug: "the-doomed-sketch", payload: { by: ACTORS.a, slug: "the-doomed-sketch", was_published: false } },
  // The withdrawal of a PUBLISHED mark — G4's whole reason.
  { who: "a", action: "withdraw", slug: "the-standing-stone", payload: { by: ACTORS.a, slug: "the-standing-stone", was_published: true } },
  { who: "b", action: "leave-mark", slug: "the-quiet-shed", payload: { kind: "sited", by: ACTORS.b, slug: "the-quiet-shed", body: "the same slug, another household — scoping's own case", at: { x: 200, y: 200 }, extent: { w: 4, h: 4 }, date: "2026-08-28" } },
  { who: "b", action: "leave-mark", slug: "bravo-ground", payload: { kind: "parcel", by: ACTORS.b, slug: "bravo-ground", body: "ground", at: { x: 300, y: 300 }, extent: { w: 25, h: 25 }, date: "2026-08-28", stamps: 1, put_forward: true } },
];

// The published mark the last withdrawal is about. Planted in `marks` (canon),
// never in `claims` — which is exactly the state 1.0 calls "was_published".
const PUBLISHED = { slug: `${ACTORS.a}/the-standing-stone`, kind: "sited", owner: ACTORS.a, household: HOUSEHOLD_KEY.a,
                    body: "a stone that stands in canon", geometry: { at: { x: 10, y: 10 }, extent: { w: 3, h: 3 } } };

// THE SCRATCH KEEPS THE TOWN'S CLOCK (2026-09-04). This population used to plant
// its open window as 999999 and stamp its rows 999999.5 — a sentinel far from any
// real crossing. The pen's late-crossing guard now refuses a crossing beyond the
// open window (a raw epoch count is the class it catches), and it judges by the
// town's clock, not the store's, because it runs before any SQL. So the scratch
// plants the REAL open crossing and files its rows half a step into it: the
// guard passes them, and the scratch is honest about when it was made.
import { currentCrossing } from "../../src/crossings.mjs";
const SCRATCH_WINDOW = currentCrossing();

async function plantPopulation(ownerClient, dbPath) {
  // identities — `householdKeyFor` reads this to resolve the household KEY, and
  // an unseeded roster would make every claim `solo:<handle>` and G2 red for a
  // reason that is the harness's rather than the port's.
  for (const [k, handle] of Object.entries(ACTORS))
    await ownerClient.query(
      "INSERT INTO identities (handle, household, status) VALUES ($1,$2,'resident') ON CONFLICT (handle) DO UPDATE SET household = EXCLUDED.household",
      [handle, HOUSEHOLD_KEY[k]]);

  // THE REGISTRY, which is what `householdKeyFor` reads since POS-160 — the
  // store-of-record 019 made these three tables into, rather than the world
  // repo's copy projected into `identities`. The floor applies 019/020/021 to
  // this lane's database, so the tables are HERE and EMPTY, and an empty
  // registry makes every claim `solo:<handle>` and G2 red for a reason that is
  // the harness's rather than the port's — which is the same sentence the
  // `identities` seed above was written to prevent, one table over.
  //
  // One house per actor, listing that actor, pinned to the same id the old
  // `gh:` key named. Both roads the deriver walks (residents[] and the pin)
  // therefore reach the same door, which is the scratch stating one fact once.
  for (const [k, handle] of Object.entries(ACTORS)) {
    await ownerClient.query(
      `INSERT INTO households (slug, ord, name, accounts, residents, since, declared_by)
       VALUES ($1, $2, $3, $4::jsonb, $5, '2026-08-28', 'falsifier-guard-equality scratch')
       ON CONFLICT (slug) DO UPDATE SET residents = EXCLUDED.residents, accounts = EXCLUDED.accounts`,
      [HOUSEHOLD_SLUG[k], k === "a" ? 0 : 1, `Guards ${k.toUpperCase()}`,
       JSON.stringify([{ login: handle, id: HOUSEHOLD_GH_ID[k] }]), [handle]]);
    await ownerClient.query(
      `INSERT INTO household_pins (handle, login, gh_id, pinned) VALUES ($1, $2, $3, '2026-08-28')
       ON CONFLICT (handle) DO UPDATE SET login = EXCLUDED.login, gh_id = EXCLUDED.gh_id`,
      [handle, handle, HOUSEHOLD_GH_ID[k]]);
  }

  // an open window — the docket pen refuses without one ("no open window — the
  // candle is dark"), and that refusal would be swallowed by its own queue.
  await ownerClient.query(
    `INSERT INTO windows (id, opens_at, closes_at, status) VALUES ($1, now() - interval '1 hour', now() + interval '1 day', 'open')
     ON CONFLICT (id) DO UPDATE SET status = 'open'`, [SCRATCH_WINDOW]);

  await ownerClient.query(
    `INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, box(point($7,$8), point($9,$10)), 'standing', $11)
     ON CONFLICT (slug) DO NOTHING`,
    [PUBLISHED.slug, PUBLISHED.kind, PUBLISHED.owner, PUBLISHED.household, PUBLISHED.body,
     JSON.stringify(PUBLISHED.geometry),
     PUBLISHED.geometry.at.x - PUBLISHED.geometry.extent.w / 2, PUBLISHED.geometry.at.y - PUBLISHED.geometry.extent.h / 2,
     PUBLISHED.geometry.at.x + PUBLISHED.geometry.extent.w / 2, PUBLISHED.geometry.at.y + PUBLISHED.geometry.extent.h / 2,
     SCRATCH_WINDOW]);

  // THE LOCKED CLAIM BEHIND THE PUBLISHED MARK. Planted as the owner, because
  // only `clearing_job` may transition one and the candle is not on trial here.
  //
  // It exists for a reason run 1 of the can-fail proof gave: the "LIVE_STATUSES
  // widened to include 'locked'" break read INERT, because the scratch store
  // held no locked claim for the break to let through. An INERT break proves
  // nothing (the standing lane's finding), and the fix belonged to the
  // POPULATION rather than to the break — a store with a published mark and no
  // claim behind it is not a store this town ever produces.
  await ownerClient.query(
    `INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, slug, stake)
     VALUES ($7, $1, $2, $3, 'locked', $4, $5, $6, 1)
     ON CONFLICT DO NOTHING`,
    [PUBLISHED.kind, PUBLISHED.owner, HOUSEHOLD_KEY.a, PUBLISHED.body,
     JSON.stringify({ slug: PUBLISHED.slug, ...PUBLISHED.geometry }), PUBLISHED.slug, SCRATCH_WINDOW]);

  const db = openDynamic(dbPath);
  for (const step of SCRIPT) {
    const entry = {
      crossing: SCRATCH_WINDOW + 0.5,
      actor: ACTORS[step.who],
      household: JOURNAL_HOUSEHOLD[step.who],
      action: step.action,
      object: `${ACTORS[step.who]}/${step.slug}`,
      at: { anchor: "the-town/let-there-be-light", dx: step.payload.at?.x ?? 0, dy: step.payload.at?.y ?? 0 },
      witnesses: { source: "test", list: [] },
      cls: CLASS_MARK,
      payload: step.payload,
      effect: "written by falsifier-guard-equality's population script",
    };
    // THE RECORD FIRST, AND AWAITED. `appendJournal` is async since G1 (RULING
    // 3: the store is the write, and it refuses rather than answering over a
    // lost act). Un-awaited, the loop finished before a single row had landed
    // and every guard below read a store still being written -- the same class
    // of defect as comparing against a docket that has not settled, which the
    // block after this loop exists to prevent.
    await appendJournal(db, entry);
    // AND 1.0's ARM, which that call no longer feeds.
    seedJournalRow(db, entry);
  }
  // THE AWAITED WRITE. The docket pen is fire-and-forget on a serial queue;
  // reading `claims` before it settles would compare 1.0's finished journal
  // against a docket still being written, and the diff would be timing.
  //
  // THIS COMMENT USED TO NAME `submitClaimFromJournal`, and that name outlived
  // the function: the mark lane's private-draft arm joined the pen's one queue
  // (C6, 2026-09-04) and the old docket queue stopped being enqueued onto. The
  // wait below did not change, and it did not have to — but `docketSettled()`
  // was still answering about the abandoned queue, so it returned instantly and
  // this run reported G1_a/G2_a/G4_a `compared 0` with every declaration missing
  // from the port. The diff was timing, exactly as the sentence above says.
  //
  // `docketSettled()` now covers the queue the docket's writes actually ride
  // (src/world2-claims.mjs), so this line is correct again and stays as it is.
  // Naming a specific writer here is what went stale, so it names none.
  await docketSettled();
  return db;
}

// ═════════════════════════════════════════════════════════════════════════════
// G1 · THE LIVE LAYER
// ═════════════════════════════════════════════════════════════════════════════
//
// A field-for-field comparison over the UNION of both sides' keys. Three keys
// are held out of it and each is checked by G2 instead — held out by NAME, in
// this list, so widening the comparison requires editing a list somebody has to
// argue with rather than loosening a predicate nobody re-reads.
const SEAM_KEYS = Object.freeze({
  stamps: "the door's `stamps:` becomes `claims.stake` — G2 checks the two against each other",
  put_forward: "the door's verdict becomes `claims.status` — G2 checks the two against each other",
  household: "1.0 carries the journal's household NAME, 2.0 the resolved KEY — G2 checks the mapping",
});
// 2.0-only bookkeeping. Not a seam and not compared: 1.0 has no row identity for
// a live mark because it has no row, and a comparison over the union of keys
// would report every one of these as a difference.
const PORT_ONLY_KEYS = Object.freeze(new Set(["claim_id", "claim_status"]));

/**
 * A key-order-independent serialization, and it is NOT a widening.
 *
 * FOUND BY RUN 2: `{"w":4,"h":4}` on 1.0's side and `{"h":4,"w":4}` on the
 * port's, on every sited mark. jsonb stores an object's keys sorted by length
 * then bytes and hands them back that way, so a round trip through `geometry`
 * reorders them. The values are identical.
 *
 * A comparison that reported this would be asserting something Postgres never
 * promised, and the finding would be permanent and meaningless — which is worse
 * than useless, because a falsifier nobody can get to green is a falsifier
 * nobody reads. Numbers, strings and arrays are still compared exactly, and
 * ARRAY order is preserved (jsonb keeps it), so `points` is untouched by this.
 */
function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])]));
  return v;
}
const canon = (v) => JSON.stringify(stable(v));

function sameMark(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const diffs = [];
  for (const k of keys) {
    if (k in SEAM_KEYS || PORT_ONLY_KEYS.has(k)) continue;
    const x = a[k], y = b[k];
    // ── `seq` ON A FLIPPED LANE: 1.0 HAS ONE, 2.0 CANNOT (C6, 2026-09-04) ──
    //
    // Held out NARROWLY — only where the port has no seq and 1.0 does, which is
    // exactly the flipped-era row and nothing else. On the shadow lane both
    // sides carry the number and it is still compared, so this buys the flip
    // nothing it did not have to pay for.
    //
    // Why the port cannot have it: on a flipped lane the claim is written
    // INSIDE the pen's transaction, and the sqlite reverse-mirror row does not
    // exist yet — `appendActFlipped` inserts it only after that transaction
    // commits. So at the moment the claim is written there is no seq to carry,
    // and inventing one would need a second write to the claim after the
    // commit: the atomicity hole R1 closed, reopened to satisfy a comparison.
    //
    // And it is bookkeeping rather than a fact about the mark. 001_tables.sql
    // calls journal_seq "the shadow-era pairing key, dying at cutover", and the
    // journal itself dies with the reverse mirror — a column scheduled to stop
    // existing is not the thing to red a guard-equality run over. The act↔claim
    // pairing that DOES matter moved to `data->>'_act_id'` in the same change
    // (src/world2-claims.mjs § `_act_id`).
    //
    // WITHOUT THIS the first guard-equality run after the mark lane flips goes
    // red on every live mark, for a difference that is the flip working.
    //
    // WHAT IT COSTS, said rather than glossed: the mark shape alone cannot tell
    // a flipped-era claim from a shadow-era claim whose `_journal_seq` went
    // missing, so this also stops catching that second thing. It is a real
    // weakening of a real check, accepted knowingly — the pairing this was
    // protecting is `_act_id`'s job now, and the column it turns on dies at the
    // cutover. If a narrower discriminator ever exists, tighten it.
    //
    // test/guard-equality-flipped-seq.test.mjs pins the fact underneath this at
    // the layer that causes it (`guard-reads.liveMarkOf`), because this file is
    // a script with no entry guard and cannot be imported to test the line
    // itself. `falsifier-pen-flip.mjs` has such a guard; giving this one the
    // same would make its pure halves testable.
    if (k === "seq" && y == null && x != null) continue;
    // `null` and absent are the SAME. 1.0 spreads a payload that simply lacks a
    // key; the port reassembles from columns that hold NULL. Treating those as a
    // divergence would make every row red for a difference that is not one.
    if (x == null && y == null) continue;
    if (canon(x) !== canon(y)) diffs.push(`${k}: 1.0 ${JSON.stringify(x)} · 2.0 ${JSON.stringify(y)}`);
  }
  return diffs;
}

export function g1LiveLayer(oneMarks, twoMarks, label) {
  const findings = [];
  const one = new Map(oneMarks.map((m) => [m.id, m]));
  const two = new Map(twoMarks.map((m) => [m.id, m]));
  let compared = 0;
  for (const [id, a] of one) {
    const b = two.get(id);
    if (!b) { findings.push(`G1[${label}] 1.0's live layer holds ${id} and the port does not — a slug-collision guard reading the port would PERMIT a duplicate`); continue; }
    compared++;
    for (const d of sameMark(a, b)) findings.push(`G1[${label}] ${id} · ${d}`);
  }
  for (const id of two.keys())
    if (!one.has(id)) findings.push(`G1[${label}] the port holds ${id} and 1.0's live layer does not — a parcel cap reading the port would overcount`);
  return { findings, compared, oracle_rows: one.size, port_rows: two.size };
}

// ═════════════════════════════════════════════════════════════════════════════
// G2 · THE THREE SEAMS, each as its own assertion
// ═════════════════════════════════════════════════════════════════════════════

export function g2Seams(oneMarks, claimRows, identities, label) {
  const findings = [];
  const byId = new Map(claimRows.map((c) => [c.slug, c]));
  let compared = 0;
  for (const m of oneMarks) {
    const c = byId.get(m.id);
    if (!c) { findings.push(`G2[${label}] no claim row for ${m.id} — G1 has already said so; the seams cannot be checked on it`); continue; }
    compared++;

    // SEAM 1 · stamps ↔ stake
    const stamps = m.stamps == null ? 0 : Number(m.stamps);
    if (Number(c.stake) !== stamps)
      findings.push(`G2[${label}] ${m.id} stake seam: the declaration carried stamps ${stamps} and the claim holds stake ${c.stake}`);

    // SEAM 2 · put_forward ↔ status. The door's verdict IS the status; a
    // declaration that put itself forward must be pending and one that did not
    // must be a draft.
    const putForward = m.put_forward === true;
    const wantStatus = putForward ? "pending" : "draft";
    if (c.status !== wantStatus)
      findings.push(`G2[${label}] ${m.id} boundary seam: put_forward ${putForward} but the claim stands at "${c.status}" — the door's verdict and the private/public boundary have come apart`);

    // SEAM 3 · household name ↔ resolved key. world2-claims.mjs's ruling,
    // verbatim: "a roster owner keeps the household KEY; a non-roster owner is
    // `solo:<handle>`, never NULL."
    const want = identities.get(m.by) ?? `solo:${m.by}`;
    if (c.household !== want)
      findings.push(`G2[${label}] ${m.id} household seam: identities says ${want} and the claim holds ${JSON.stringify(c.household)}`);
  }
  return { findings, compared };
}

// ═════════════════════════════════════════════════════════════════════════════
// G3 · THE CHILDREN — asked about every id, empties included
// ═════════════════════════════════════════════════════════════════════════════

export async function g3Children(db, client, name, key, ids, mangleParent = null) {
  const findings = [];
  let compared = 0;
  for (const id of ids) {
    const one = liveChildrenOf(db, id, { household: name }).map((m) => m.id).sort();
    let two = (await guards.pgLiveChildrenOf(client, id, { household: key })).children.map((m) => m.id).sort();
    if (mangleParent) two = mangleParent(id, two);
    compared++;
    if (JSON.stringify(one) !== JSON.stringify(two))
      findings.push(`G3 children of ${id}: 1.0 ${JSON.stringify(one)} · 2.0 ${JSON.stringify(two)} — the stranding check reads this, and a withdrawal that strands its children is what disagreeing here costs`);
  }
  return { findings, compared };
}

// ═════════════════════════════════════════════════════════════════════════════
// G4 · THE DRAFT OVERLAY
// ═════════════════════════════════════════════════════════════════════════════
//
// Both sides get THE SAME canon and THE SAME `pathFor`. What is left on trial is
// the row reconstruction and the deleted arm — which is the whole point: the
// fold is 1.0's own function on one side and refused-and-injected on the other,
// so a disagreement can only be about what this port read out of the store.

const OVERLAY_KEYS = ["id", "status", "by", "kind", "tier", "body", "at", "extent", "points"];

export function g4Overlay(oneMarks, twoMarks) {
  const findings = [];
  const one = new Map(oneMarks.map((m) => [m.id, m]));
  const two = new Map(twoMarks.map((m) => [m.id, m]));
  let compared = 0;
  for (const [id, a] of one) {
    const b = two.get(id);
    if (!b) {
      findings.push(`G4 1.0's overlay draws ${id} (${a.status}) and the port does not` +
        (a.status === "deleted" ? " — this is the deleted arm, and `claims` holds no row of any status for a withdrawn PUBLISHED mark" : ""));
      continue;
    }
    compared++;
    for (const k of OVERLAY_KEYS) {
      const x = a[k], y = b[k];
      if (x == null && y == null) continue;
      if (canon(x) !== canon(y)) findings.push(`G4 ${id} · ${k}: 1.0 ${JSON.stringify(x)} · 2.0 ${JSON.stringify(y)}`);
    }
  }
  for (const id of two.keys()) if (!one.has(id)) findings.push(`G4 the port draws ${id} and 1.0's overlay does not`);
  return { findings, compared, oracle_rows: one.size, port_rows: two.size };
}

// ═════════════════════════════════════════════════════════════════════════════
// G5 · THE HOLDER FOLD
// ═════════════════════════════════════════════════════════════════════════════
//
// THE ORACLE IS 1.0'S RECOVERY COVENANT, RUN. `dynamic-rebuild.mjs`'s own
// sentence is the claim under test: attachments are "store-canon-durable — no
// ledger holds them, so the crossing-save is their only way back". So the oracle
// is that way back, taken: `attachmentsFromState` over the world checkout's
// STATE, replayed through `declareAttachment` into a throwaway sqlite, and read
// with `readAttachments`. Every function in that chain is 1.0's.
//
// It is NOT the lab's `attachments` table, and that is measured rather than
// preferred: both the lab office's and the dev office's tables hold ZERO rows
// (2026-08-28), so an equality against them would compare 43 rows to nothing and
// call the port wrong — or, worse, compare nothing to nothing and call it green.

export function buildOracleAttachments(stateDir, dbPath) {
  const found = attachmentsFromState(stateDir);
  if (found.reason) return { rows: [], reason: found.reason, crossing: found.crossing };
  const db = openDynamic(dbPath);
  // Applied in born_at order, which is the order `readAttachments` reads them
  // back in and the order `dynamic-rebuild.mjs`'s own loop would apply them in
  // over a directory listing. sqlite's `seq` is then insertion order, which is
  // the tiebreak the real store's seq is.
  for (const a of [...found.attachments].sort((x, y) => (x.born_at < y.born_at ? -1 : x.born_at > y.born_at ? 1 : 0)))
    declareAttachment(db, { entity: a.entity, target: a.target, policy: a.policy, declaredBy: a.declared_by, bornAt: a.born_at });
  const rows = readAttachments(db);
  db.close();
  return { rows, reason: null, crossing: found.crossing };
}

const sameAttachment = (a, b) =>
  a.entity === b.entity && a.target === b.target && a.policy === b.policy
  && (a.declared_by ?? null) === (b.declared_by ?? null)
  && new Date(a.born_at).toISOString() === new Date(b.born_at).toISOString();

export function g5Holdings(oracleRows, portRows) {
  const findings = [];
  let compared = 0;

  // 5a · THE ROWS, IN ORDER. Position matters and is compared as position: the
  // whole of `liveHolder` is "the last row", so two lists holding the same rows
  // in different orders are two different answers about who holds what.
  const n = Math.min(oracleRows.length, portRows.length);
  if (oracleRows.length !== portRows.length)
    findings.push(`G5 the record lengths differ: 1.0's recovery yields ${oracleRows.length} attachment rows, the port yields ${portRows.length}`);
  for (let i = 0; i < n; i++) {
    compared++;
    if (!sameAttachment(oracleRows[i], portRows[i]))
      findings.push(`G5 row ${i} differs\n      1.0:  ${JSON.stringify(oracleRows[i])}\n      port: ${JSON.stringify(portRows[i])}`);
  }

  // 5b · THE HOLDER, PER TARGET. The answer the door actually asks for, over
  // every target either side knows — so a target one side lost is a finding and
  // not a shorter loop.
  const targets = [...new Set([...oracleRows, ...portRows].map((r) => r.target))].sort();
  for (const t of targets) {
    const a = liveHolder(oracleRows, t);
    const b = guards.pgHolderOf(portRows, t);
    compared++;
    if (a !== b) findings.push(`G5 holder of ${t}: 1.0 says ${JSON.stringify(a)} · the port says ${JSON.stringify(b)}`);
  }

  // 5c · WHAT EACH RESIDENT HOLDS. `holdingsOf` is the `world_holdings` door's
  // whole answer, and it folds every target rather than one.
  const handles = [...new Set([...oracleRows, ...portRows].map((r) => r.entity))].sort();
  for (const h of handles) {
    const a = holdingsOf(oracleRows, h).sort();
    const b = guards.pgHoldingsOf(portRows, h).sort();
    compared++;
    if (JSON.stringify(a) !== JSON.stringify(b))
      findings.push(`G5 holdings of ${h}: 1.0 ${JSON.stringify(a)} · the port ${JSON.stringify(b)}`);
  }
  return { findings, compared, oracle_rows: oracleRows.length, port_rows: portRows.length, targets: targets.length };
}

// ═════════════════════════════════════════════════════════════════════════════
// G6 · THE RLS REFUSAL, AND WHAT THE CREDENTIAL CANNOT SEE
// ═════════════════════════════════════════════════════════════════════════════

export async function g6Rls(pool, household, ownerPool, devOwnerUrl) {
  const findings = [];
  let compared = 0;

  // 6a · the refusal fires on an undeclared connection.
  const bare = await pool.connect();
  try {
    compared++;
    let refused = null;
    try { await guards.pgLiveMarks(bare, { household }); }
    catch (e) { refused = String(e.message); }
    if (!refused)
      findings.push("G6 a household-scoped read ran on a connection that had NOT declared app.household. 007's policy " +
                    "would have answered without that household's drafts and said nothing — a slug-collision guard " +
                    "reading it PERMITS a duplicate. assertHouseholdDeclared is not doing its job.");
    else if (!refused.includes("app.household"))
      findings.push(`G6 the read refused, but not by naming the policy: ${refused.slice(0, 160)}`);
  } finally { bare.release(); }

  // 6b · THE MEASUREMENT BEHIND `DISCLOSURES.cross_household`. How many draft
  // rows exist that office_api's cross-household read cannot see? The owner is
  // the positive control — 007 deliberately does not FORCE row security on the
  // table owner ("no runtime pen holds that role"), so it sees everything.
  compared++;
  const { rows: [asOwner] } = await ownerPool.query("SELECT count(*)::int AS n FROM claims WHERE status = 'draft'");
  const asOffice = await pool.connect();
  let seen = 0;
  try {
    const { rows: [r] } = await asOffice.query("SELECT count(*)::int AS n FROM claims WHERE status = 'draft'");
    seen = r.n;
  } finally { asOffice.release(); }
  const hidden = asOwner.n - seen;
  if (asOwner.n > 0 && hidden === 0)
    findings.push(`G6 office_api sees all ${asOwner.n} draft claim(s) on an undeclared connection — 007's row policy is ` +
                  `NOT holding, and DISCLOSURES.cross_household describes a store this is not.`);

  // 6c · the same question on the real store, which is the number the disclosure
  // is actually about. Read-only, owner credential, no writes.
  let devHidden = null;
  if (devOwnerUrl) {
    const devOwner = new pg.Pool({ connectionString: devOwnerUrl, max: 1 });
    try {
      const { rows: [d] } = await devOwner.query("SELECT count(*)::int AS n FROM claims WHERE status = 'draft'");
      devHidden = d.n;
    } catch { devHidden = null; } finally { await devOwner.end(); }
  }
  return { findings, compared, scratch_drafts: asOwner.n, scratch_visible_undeclared: seen, dev_drafts: devHidden };
}

// ═════════════════════════════════════════════════════════════════════════════
// THE RUN
// ═════════════════════════════════════════════════════════════════════════════

const tmp = mkdtempSync(join(tmpdir(), "guards-lane-"));
const scratchPool = new pg.Pool({ connectionString: process.env.W2_GUARDS_URL, max: 4 });
const ownerPool = new pg.Pool({ connectionString: process.env.W2_GUARDS_OWNER_URL, max: 2 });
const devPool = new pg.Pool({ connectionString: DEV_URL, max: 2 });
let out = {};
let db = null;

try {
  const ownerClient = await ownerPool.connect();
  try { db = await plantPopulation(ownerClient, join(tmp, "dynamic.db")); }
  finally { ownerClient.release(); }

  const { rows: idRows } = await ownerPool.query("SELECT handle, household FROM identities");
  const identities = new Map(idRows.map((r) => [r.handle, r.household]));
  const publishedIds = new Set([PUBLISHED.slug]);
  const canonById = new Map([[PUBLISHED.slug, { id: PUBLISHED.slug, by: PUBLISHED.owner, kind: PUBLISHED.kind, body: PUBLISHED.body, at: PUBLISHED.geometry.at, extent: PUBLISHED.geometry.extent }]]);
  const publishedMarkOf = (id) => canonById.get(id) ?? null;
  // 1.0's own filing, minus the git half: there is no world checkout holding
  // these test marks, so `publishedPathOf` is the canon map's own answer. Both
  // sides get the SAME function, which is what keeps `path` on trial rather
  // than exempt.
  const publishedPathOf = (id) => (canonById.has(id) ? `WORLD/marks/${id}/mark.md` : null);

  const g = {};
  const overlays = {};
  for (const k of Object.keys(HOUSEHOLD_KEY)) {
    const name = JOURNAL_HOUSEHOLD[k];   // 1.0's scope: the office key's household NAME
    const key = HOUSEHOLD_KEY[k];        // 2.0's scope: the resolved KEY
    const oneMarks = liveMarks(db, { household: name });
    const two = await withHousehold(scratchPool, key, (c) => guards.pgLiveMarks(c, { household: key }));
    g[`G1_${k}`] = g1LiveLayer(oneMarks, two.marks, k);

    const { rows: claimRows } = await withHousehold(scratchPool, key, (c) =>
      c.query("SELECT slug, status, stake, household FROM claims WHERE status = ANY($1)", [guards.LIVE_STATUSES]));
    g[`G2_${k}`] = g2Seams(oneMarks, claimRows, identities, k);

    const ids = [...new Set([...oneMarks.map((m) => m.id), ...two.marks.map((m) => m.id), `${ACTORS[k]}/the-quiet-shed`])];
    g[`G3_${k}`] = await withHousehold(scratchPool, key, (c) => g3Children(db, c, name, key, ids));

    const oneOverlay = replayDrafts(readJournal(db, { household: name, cls: CLASS_MARK }), { publishedIds, publishedPathOf, publishedMarkOf });
    const twoOverlay = await withHousehold(scratchPool, key, (c) =>
      guards.pgDraftsForKey(c, { household: key, journalHousehold: name, publishedIds, publishedPathOf, publishedMarkOf, pathFor }));
    overlays[k] = { one: oneOverlay, two: twoOverlay };
    g[`G4_${k}`] = g4Overlay(oneOverlay.marks, twoOverlay.marks);
  }

  // G5 — the real store, read-only.
  const oracle = buildOracleAttachments(join(REPO, "STATE"), join(tmp, "oracle.db"));
  if (oracle.reason) die(`G5's oracle could not be built from ${REPO}/STATE: ${oracle.reason} — a run that skipped G5 would report a green it did not earn`);
  const devClient = await devPool.connect();
  let portAttachments;
  try { portAttachments = await guards.pgAttachmentsFor(devClient); }
  finally { devClient.release(); }
  g.G5 = g5Holdings(oracle.rows, portAttachments.rows);

  g.G6 = await g6Rls(scratchPool, HOUSEHOLD_KEY.a, ownerPool, process.env.W2_OWNER_URL ?? null);

  const findings = Object.values(g).flatMap((r) => r.findings);
  const unchecked = Object.entries(g).filter(([, r]) => !r.compared).map(([k]) => k);

  const { rows: [hr] } = await ownerPool.query("SELECT count(*)::int AS n FROM claims WHERE status = 'held_review'");
  const liveClaims = (await ownerPool.query("SELECT slug, household FROM claims WHERE status = ANY($1)", [guards.LIVE_STATUSES])).rows;

  // THE TWO SPELLINGS, MEASURED ON THE REAL STORE — the number behind
  // DISCLOSURES.two_household_spellings, not a number this file remembers.
  const devOwner = process.env.W2_OWNER_URL ? new pg.Pool({ connectionString: process.env.W2_OWNER_URL, max: 1 }) : null;
  let actsHouseholds = [], claimHouseholds = [];
  if (devOwner) {
    try {
      actsHouseholds = (await devOwner.query("SELECT DISTINCT household FROM acts WHERE household IS NOT NULL")).rows.map((r) => r.household);
      claimHouseholds = (await devOwner.query("SELECT DISTINCT household FROM claims WHERE household IS NOT NULL")).rows.map((r) => r.household);
    } catch { /* the count is a disclosure, not a gate */ } finally { await devOwner.end(); }
  }

  out = {
    world_repo: REPO,
    scratch: { households: HOUSEHOLD_KEY, journal_households: JOURNAL_HOUSEHOLD, declarations: SCRIPT.length },
    store: {
      oracle_attachments: oracle.rows.length, port_attachments: portAttachments.rows.length,
      attachment_eras: portAttachments.eras, oracle_from_crossing: oracle.crossing,
      dev_drafts: g.G6.dev_drafts,
    },
    equalities: Object.fromEntries(Object.entries(g).map(([k, r]) => [k, { compared: r.compared, findings: r.findings.length }])),
    unchecked, findings,
    notes: guards.admissionNotes({ claims: liveClaims, attachments: portAttachments.rows, heldReview: hr.n,
                                   actsHouseholds, claimHouseholds }),
    refusals: [...portAttachments.refusals],
    disclosures: Object.keys(guards.DISCLOSURES),
  };

  if (has("--prove-can-fail")) {
    // Every break is in MEMORY or against the SCRATCH database — `world2_dev` is
    // never written. Each is a plausible way this port could be wrong, and each
    // is aimed at the ONE equality whose oracle it cannot reach. The live lane's
    // finding, applied: a break fed to BOTH sides of an equality agrees with
    // itself, and four of that lane's first breaks read SILENT for exactly that.
    const results = [];
    const proof = async (label, run) => {
      try {
        const r = await run();
        const findings = Array.isArray(r) ? r : r.findings;
        const bit = Array.isArray(r) ? null : r.bit;
        results.push({ mangle: label, findings: findings.length, bit, first: findings[0]?.split("\n")[0] ?? null });
      } catch (err) {
        results.push({ mangle: label, findings: -1, bit: null, note: `threw: ${String(err.message).slice(0, 160)}` });
      }
    };

    const hh = HOUSEHOLD_KEY.a;       // the claims scope
    const hname = JOURNAL_HOUSEHOLD.a; // the journal scope
    const oneA = liveMarks(db, { household: hname });

    // 1 · LIVE_STATUSES WIDENED to include 'locked' — canon counted as live.
    //     Aimed at G1, whose oracle is 1.0's own journal fold.
    await proof("LIVE_STATUSES widened to include 'locked' (canon counted as the live layer)", async () => {
      const two = await withHousehold(scratchPool, hh, (c) =>
        guards.pgLiveMarks(c, { household: hh, statuses: [...guards.LIVE_STATUSES, "locked"] }));
      const base = await withHousehold(scratchPool, hh, (c) => guards.pgLiveMarks(c, { household: hh }));
      return { bit: two.marks.length - base.marks.length, findings: g1LiveLayer(oneA, two.marks, "mangle").findings };
    });

    // 2 · THE HOUSEHOLD SEAM INVERTED — the resolved key read as the handle.
    //     Aimed at G2, whose oracle is `identities`.
    await proof("claims.household read as the bare handle (the resolved-key edge)", () => {
      const bad = oneA.map((m) => ({ slug: m.id, status: m.put_forward ? "pending" : "draft", stake: m.stamps ?? 0, household: m.by }));
      const bit = bad.filter((c) => c.household !== hh).length;
      return { bit, findings: g2Seams(oneA, bad, identities, "mangle").findings };
    });

    // 3 · parent_id READ FROM THE WRONG PLACE — the children answer emptied.
    //     Aimed at G3, whose oracle is 1.0's own liveChildrenOf.
    await proof("parent_id read as absent (the stranding check answers empty)", async () => {
      const ids = oneA.map((m) => m.id);
      let bit = 0;
      const r = await withHousehold(scratchPool, hh, (c) =>
        g3Children(db, c, hname, hh, ids, (id, kids) => { if (kids.length) bit += kids.length; return []; }));
      return { bit, findings: r.findings };
    });

    // 4 · THE DELETED ARM DROPPED — a withdrawal of a published mark unseen.
    //     Aimed at G4, whose oracle is 1.0's own replayDrafts over the journal.
    await proof("the deleted arm dropped (a published mark's withdrawal goes unseen)", () => {
      const two = overlays.a.two.marks.filter((m) => m.status !== "deleted");
      return { bit: overlays.a.two.marks.length - two.length, findings: g4Overlay(overlays.a.one.marks, two).findings };
    });

    // 5 · THE ORDER — attachments read by acts.id instead of the record's own
    //     born_at. Aimed at G5, whose oracle is 1.0's recovery chain.
    await proof("attachments read in acts.id order (latest-wins handed the seed's insert order)", async () => {
      const c = await devPool.connect();
      try {
        const { rows } = await c.query(
          "SELECT id, at, actor, action, payload FROM acts WHERE action = ANY($1) ORDER BY acts.id DESC", [guards.ATTACHMENT_ACTIONS]);
        const recs = rows.map((r) => guards.attachmentRowOf(r)).filter((r) => !r.refused).map((r) => ({ ...r.row, era: r.era }));
        const moved = recs.filter((r, i) => r.born_at !== portAttachments.rows[i]?.born_at).length;
        return { bit: moved, findings: g5Holdings(oracle.rows, recs).findings };
      } finally { c.release(); }
    });

    // 6 · THE ACTOR TRAP — the live era's entity read as `acts.actor`, which in
    //     that era is the DECLARER and not the holder. Aimed at G5, whose
    //     oracle is 1.0's own `liveHolder`.
    //
    //     THE ROWS ARE SYNTHESIZED, and that is stated rather than hidden:
    //     nothing has been given, dropped or taken since the mirror shipped, so
    //     `acts` holds no live-era holding row for this break to bend. The
    //     alternative was to leave the era's sharpest trap untested until the
    //     first give, which is the wrong side of the record to discover it on.
    //     `bit` counts the synthesized rows, so this reads RED rather than
    //     INERT, and the census note beside it says the era is unexercised.
    await proof("the live era's entity read as acts.actor (every give handed back to the giver)", () => {
      const give = { id: "synthetic-1", at: new Date("2026-08-29T00:00:00.000Z"), actor: ACTORS.a, action: "give",
                     payload: { thing: `${ACTORS.a}/the-lamp`, holder: ACTORS.b, previous_holder: ACTORS.a, made_by: ACTORS.a, policy: "cascade" } };
      const drop = { id: "synthetic-2", at: new Date("2026-08-29T00:01:00.000Z"), actor: ACTORS.b, action: "drop",
                     payload: { thing: `${ACTORS.a}/the-other-lamp`, holder: null, previous_holder: ACTORS.b, made_by: ACTORS.a, policy: "detach" } };
      const right = [give, drop].map((a) => guards.attachmentRowOf(a).row);
      const wrong = right.map((r, i) => ({ ...r, entity: [give, drop][i].actor }));
      return { bit: wrong.filter((r, i) => r.entity !== right[i].entity).length,
               findings: g5Holdings(right, wrong).findings };
    });

    // 7 · THE RLS ASSERTION REMOVED — the read runs undeclared.
    //     Aimed at G6, and it is the one break whose oracle is Postgres itself.
    await proof("the RLS assertion removed (a household-scoped read on an undeclared connection)", async () => {
      const c = await scratchPool.connect();
      try {
        const { rows } = await c.query(`${guards.LIVE_CLAIM_SELECT} WHERE status = ANY($1) AND household = $2 ORDER BY slug`,
          [guards.LIVE_STATUSES, hh]);
        const undeclared = guards.liveMarkRecords(rows).marks;
        const declared = await withHousehold(scratchPool, hh, (cc) => guards.pgLiveMarks(cc, { household: hh }));
        return { bit: declared.marks.length - undeclared.length,
                 findings: declared.marks.length === undeclared.length
                   ? [] : [`an undeclared read returns ${undeclared.length} of ${declared.marks.length} live marks — the missing ones are drafts, and nothing said so`] };
      } finally { c.release(); }
    });

    out.can_fail = {
      results,
      silent: results.filter((r) => r.findings === 0 && r.bit !== 0).map((r) => r.mangle),
      inert: results.filter((r) => r.bit === 0).map((r) => r.mangle),
      threw: results.filter((r) => r.findings === -1).map((r) => r.mangle),
    };
  }
} catch (err) {
  console.error(err.stack);
  die(err.message);
} finally {
  try { db?.close(); } catch { /* already gone */ }
  await scratchPool.end().catch(() => {});
  await ownerPool.end().catch(() => {});
  await devPool.end().catch(() => {});
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows handles */ }
}

// ── the report ───────────────────────────────────────────────────────────────

if (has("--json")) console.log(JSON.stringify(out, null, 2));
else {
  const s = out.store;
  console.log(`scratch ${out.scratch.declarations} declarations across ${Object.keys(out.scratch.households).length} households · ` +
              `holdings: oracle ${s.oracle_attachments} rows (recovered from crossing ${s.oracle_from_crossing}) · port ${s.port_attachments} ` +
              `(legacy ${s.attachment_eras.legacy} · live ${s.attachment_eras.live})`);
  for (const [k, v] of Object.entries(out.equalities))
    console.log(`  ${v.findings ? "✗" : "·"} ${k.padEnd(8)} compared ${String(v.compared).padStart(4)}  findings ${v.findings}`);
  for (const n of out.notes) console.log(`  ⚑ ${n}`);
  for (const r of out.refusals.slice(0, 5)) console.log(`  ⚑ refused: ${r}`);
  for (const f of out.findings) console.log(`  ✗ ${f}`);
  if (out.unchecked.length) console.log(`  ⚑ compared nothing: ${out.unchecked.join(", ")} — a green here is unearned`);
  if (out.can_fail) {
    console.log("\ncan-fail proof (the port broken on purpose; world2_dev is never written):");
    for (const r of out.can_fail.results)
      console.log(r.bit === 0
        ? `  INERT  ${r.mangle} — the break altered no input, so it proves nothing here`
        : `  ${r.findings > 0 ? "RED   " : r.findings === 0 ? "SILENT" : "THREW "} ${r.mangle} — ${r.findings > 0 ? `${r.findings} finding(s)` : r.findings === 0 ? "NOTHING NOTICED" : r.note}`);
    console.log(out.can_fail.silent.length
      ? `  can-fail NOT PROVEN: ${out.can_fail.silent.length} break(s) went unnoticed`
      : "  can-fail PROVEN: every break turned the falsifier red");
  }
  console.log(out.findings.length ? `\nRED · ${out.findings.length} finding(s)` : "\nGREEN · the port and 1.0's own functions agree on every row compared");
}
if (out.unchecked?.length) process.exit(2);
if (out.can_fail?.silent.length) process.exit(1);
process.exit(out.findings.length ? 1 : 0);
