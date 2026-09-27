// world2-guards.mjs — B1: `world2/tools/guard-reads.mjs`, WIRED INTO THE DOORS.
//
// WHY THIS FILE EXISTS (runbook § 4 B1, quoted):
//
//   "`world2/tools/guard-reads.mjs` is merged, tested (falsifier-guard-equality.mjs,
//    G1–G6 green, seven injected faults each firing) — AND IMPORTED BY NOTHING.
//    `grep -rn "guard-reads" src/` returns zero hits. It is the split-brain gate,
//    finished and unwired."
//
// This module is the wire. It is the ONLY thing in `src/` that imports the port,
// so the port keeps its own law — "pure over rows and a pg client, nothing from
// `src/` is imported" — and the office keeps one place where the flag is read,
// one place where the household spelling is resolved, and one place where an
// unreachable guard turns into a refusal.
//
// ── THE FLAG IS READ, NOT MERELY SET (the flip's own discipline) ─────────────
//
// The runbook's §1 sentence about the C-series governs this lane too: "A flag is
// necessary and not sufficient … Every C-step is *wire the call site, then set
// the flag* — two things, and the receipt must prove both." So `W2_GUARDS=1` is
// read at each guard, through `guardsFlipped()`, and the receipt for this lane
// is the same shape as `penFor`'s: a probe that shows the door taking the other
// branch under the flag. A flag nothing reads is a state with no receipt.
//
// It rides `world2Enabled` the way `laneFlipped` does, and for the same reason:
// reading guards out of Postgres with no `WORLD2_PG_URL` is not a configuration,
// it is a crash waiting for the first duplicate slug.
//
// ── AN UNREACHABLE GUARD REFUSES. IT NEVER PERMITS. ─────────────────────────
//
// D2's ruling is about the pen — "the office's record cannot be reached — nothing
// was written, and nothing was lost" — and the same sentence is the right answer
// here for a sharper reason, which the port's own README states:
//
//   "the LIVE tier reads and this one PERMITS. A read tier that drops a row
//    answers with a number nobody can check; a guard that drops a row lets a
//    duplicate slug or a fourth parcel through, and the receipt for that arrives
//    at the next settlement."
//
// So there is NO silent fall-back to the 1.0 guard when the port cannot answer.
// A fall-back would be defensible on the runbook's own ROLLBACK sentence ("the
// 1.0 guards are still correct while the reverse mirror holds") — and it would
// still be wrong, because it would make the flip's failure mode INVISIBLE: the
// office would quietly validate against sqlite while every other receipt in the
// lane said Postgres. That is the split brain with a switch on it, wearing a
// fallback's coat.
//
// ── AND THE FLAG-OFF FALLBACK IS GONE TOO (G1 / POS-156, RULING 3a) ─────────
//
// `guardedLiveMarks`, `guardedLiveChildrenOf` and `guardedDraftsForKey` each
// read the sqlite journal when `W2_GUARDS` was not "1". That branch was the
// runbook's rollback — "Rollback here is REMOVING THE FLAG, deliberately, by a
// hand that knows it did so" — and it rested on the premise in the sentence
// above: "the 1.0 guards are still correct WHILE THE REVERSE MIRROR HOLDS."
//
// G1 removed the journal INSERT, so the mirror does not hold and the premise is
// repealed. A guard reading a journal nobody fills does not fail; it reads an
// EMPTY live layer, and this file's own next section says what that does:
// "PERMITS EVERYTHING — every duplicate slug, every parcel past the cap — with
// nothing on any page to show for it." A rollback that opens the town to
// duplicate slugs is not a rollback.
//
// So the three read the store unconditionally and refuse when it cannot be
// reached. This is not a new shape: THE HOLD SHELF'S READS below have run it
// since POS-153 — "there is no `guardsFlipped()` branch here and no sqlite
// fallback underneath" — on Everything Reads the Store's own sentence, that the
// flag is the disease. `guardedAttachments` KEEPS its flag, and the difference
// is the whole test: its fallback reads `dynamic.db/attachments`, a table G1
// does not touch, so its 1.0 arm still answers from a store that is still
// written.
//
// Prod runs `W2_GUARDS=1`, so nothing live changes on the day this lands; what
// goes is the ability to roll the read half back onto a store that no longer
// holds the rows. That went with the INSERT, not with this edit.
//
// ── THE HOUSEHOLD SPELLING, WHICH IS THE SEAM THAT BITES ────────────────────
//
// 1.0's guards are scoped by the household NAME (`resolvedWorldHousehold(key)`,
// the office key's own word — 'darko'). `claims.household` holds the RESOLVED KEY
// ('gh:67605380', 'solo:the-town'). `guard-reads.mjs` says this out loud in
// `DISCLOSURES.two_household_spellings`, and it is not cosmetic: a guard scoped
// by the wrong spelling reads an EMPTY live layer and then PERMITS EVERYTHING —
// every duplicate slug, every parcel past the cap — with nothing on any page to
// show for it. So every household-scoped read in this file goes through
// `householdKeyFor`, world2-claims.mjs's ONE resolver, inside the same
// transaction that declares `app.household` for 007's row policy. Nothing here
// may reach a household-scoped read any other way.
//
// ── WHAT IS DELIBERATELY NOT WIRED, AND WHY ─────────────────────────────────
//
// `worldForStances` (world-stance.mjs) — declare-stance-on's candidate list — is
// named in the port's table and is NOT wired here. It is 1.0's one CROSS-
// household live read, and the port answers it structurally narrower.
// `DISCLOSURES.cross_household`, verbatim:
//
//   "a cross-household live read (household: null) is NARROWER than 1.0's by
//    exactly the other households' DRAFTS. 007's row policy makes a draft
//    visible only inside a transaction that named its household, and there is no
//    household to name here. 1.0's `worldForStances` deliberately surfaces
//    another household's sketch when it overlaps ground you hold — 'the ONE
//    place a sketch becomes visible to somebody who did not write it', which
//    the-late-welcome asks for. Under 007 that is not narrowable, it is
//    unrepresentable for office_api. WHICH LAW GIVES WAY IS A RULING, AND IT IS
//    NOT THIS PORT'S TO MAKE."
//
// It is not this module's to make either. Wiring it would silently delete
// the-late-welcome — a candidate list that got shorter, with every policy
// working exactly as written. Teed for the founder in the B1 report.
//
// ── RULED 2026-09-22 (Wright, G1 overnight RULING 2; POS-195) ──────────────
//
// NEITHER law gave way, and `worldForStances` is still NOT wired here — which
// is the part to notice before reaching for it. It reads the store through a
// THIRD credential, `stance_reader` (world2/schema/023_stance_reader.sql),
// whose own pool lives at `world2-acts.mjs § stanceQuery` and whose column
// list omits `claims.body`. Everything this module does stays on `office_api`,
// and `office_api` is still blind to another household's draft — here and
// everywhere. The disclosure above is therefore still true as written; only
// its last sentence has been answered.

import { world2Enabled } from "./world2-acts.mjs";
import { officeRead } from "./world2-pen.mjs";
import * as port from "../world2/tools/guard-reads.mjs";

/**
 * The guard port could not answer. Carries D2's sentence, because the resident
 * is owed the same truth here as at the pen: nothing happened, and nothing was
 * lost by it.
 */
export class GuardsUnreachableError extends Error {
  constructor(which, cause) {
    super("the office's record cannot be reached — nothing was written, and nothing was lost");
    this.name = "GuardsUnreachableError";
    this.code = 503;
    this.which = which;
    this.hint =
      // THE SENTENCE NAMES NO FLAG SINCE G1 (POS-156, RULING 3a). It said
      // "(W2_GUARDS=1)", which was true while the flag chose between the record
      // and the sqlite journal. There is no second place to read from now, so
      // this fires whether or not the flag is set -- and an operator sent to
      // check a variable that is not the cause is an operator looking in the
      // wrong place.
      `this door validates against the office's own record, and the ${which} guard could not read it. ` +
      `The door refuses rather than permitting on a guess — a guard that cannot see your neighbours' claims would ` +
      `let a duplicate slug or a parcel past the cap stand, and the receipt for that arrives at the next settlement. ` +
      `Nothing was written; your act is safe to make again.`;
    this.cause = cause;
  }
}

/**
 * Is the read half flipped? `W2_GUARDS=1`, read here and nowhere else.
 *
 * Exactly `"1"` — not truthiness. `W2_GUARDS=0` reading as ON is the class of
 * bug that makes a flag unreadable from the outside, and the roll-call's whole
 * discipline is that what is live can be read off the box.
 */
export function guardsFlipped(env = process.env) {
  if (!world2Enabled(env)) return false;
  return String(env.W2_GUARDS ?? "").trim() === "1";
}

// ── THE ONE SEAM, AND WHY IT IS HERE ────────────────────────────────────────
//
// world-hold.mjs's `deps` won its argument this way and the same one applies:
// "`deps` exist so the ordering can be proven on a hand-built store with no
// world db and no Postgres — the door injects the real ones."
//
// The claim this lane has to prove is a DOOR's behaviour, not a port's: "a
// deliberate duplicate-slug submission is refused at the door with the reason
// named" (runbook §4 B1's third GO). The port's own equality falsifier needs
// Postgres, a world checkout and a scratch database, so it can only ever run on
// the box; the refusal at the door has to be provable anywhere, or it is proven
// once and never again. Hence one swappable reader, restored by the function
// that installed it — the doors above thread nothing, so a caller cannot pass a
// reader in by accident.
let readerOverride = null;

/**
 * Install a stand-in for `officeRead` and return the undo.
 *
 * `test/world2-guard-doors.test.mjs` hands in a hand-built client. Nothing in
 * `src/` calls this.
 */
export function useGuardReader(read) {
  const prev = readerOverride;
  readerOverride = read;
  return () => { readerOverride = prev; };
}

const reading = (fn) => (readerOverride ?? officeRead)(fn);

/** The one place a port throw becomes the door's refusal. */
const refusing = async (which, fn) => {
  try { return await fn(); }
  catch (err) {
    if (err instanceof GuardsUnreachableError) throw err;
    throw new GuardsUnreachableError(which, err);
  }
};

/**
 * Run `fn(client, householdKey)` inside one READ ONLY transaction that has
 * declared the household 007's policy asks about.
 *
 * `name` is 1.0's household NAME; `householdKey` is what `claims.household`
 * holds. Both are handed to `fn` so a read that needs the second spelling (the
 * withdraw acts, whose column carries the FIRST) can have it without resolving
 * twice — `householdKeyFor` is memoised per handle, so the second call is free,
 * but two resolvers is how the spellings came apart in the first place.
 */
async function scoped(name, fn) {
  return reading(async (client) => {
    const { householdKeyFor } = await import("./world2-claims.mjs");
    const { sessionKeysVia, sessionKeyString } = await import("./household-deriver.mjs");
    const key = name == null ? null : await householdKeyFor(client, name);
    if (key != null) {
      // TWO SETTINGS, one fact. `app.household` is the ONE CURRENT spelling —
      // what `guard-reads.mjs § assertHouseholdDeclared` names, and what the
      // pen writes. `app.household_keys` is every spelling this house has ever
      // carried, which is what `024_household_spellings.sql` compares against.
      //
      // THE SET MATTERS MOST HERE, and it is a PERMIT rather than a leak if it
      // is missing: `guard-reads.mjs § THE RLS CONTRACT` spells it out — a
      // slug-collision guard that cannot see a household's `gh:`-spelled drafts
      // finds no collision and permits a duplicate, and a parcel cap
      // undercounts. The store never re-spells a row, so the set is the only
      // way this guard sees the whole house.
      const keys = await sessionKeysVia(client, key);
      await client.query("SELECT set_config('app.household', $1, true)", [key]);
      await client.query("SELECT set_config('app.household_keys', $1, true)",
        [sessionKeyString(keys) ?? ""]);
      return fn(client, key, keys);
    }
    return fn(client, key, []);
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// GUARD 1 · `liveMarks` / `liveChildrenOf` — the mark door's own live layer
// ═════════════════════════════════════════════════════════════════════════════
//
// Consumers, from the port's table: leave-mark's slug collision, the parcel cap,
// withdraw's stranding check. All three are in `src/world.mjs`, both already
// async, and both read the live layer ONCE and reuse it — so the guard is one
// round trip per declaration, not one per predicate.

/**
 * 1.0's `liveMarks(db, {household})`, answered from `claims` under the flag.
 *
 * `strict: true` is the port's default and is kept: a claim this cannot read as
 * a mark THROWS rather than being skipped, and the throw becomes the refusal
 * above. A skipped row is the permissive direction, and permissive is the one
 * direction a guard may not fail in.
 */
export async function guardedLiveMarks(db, { household = undefined } = {}) {
  return refusing("live-marks", async () =>
    scoped(household ?? null, async (client, key) => {
      const { marks } = await port.pgLiveMarks(client, { household: key });
      return marks;
    }));
}

/**
 * 1.0's `liveChildrenOf(db, id, {household})` — withdraw's stranding check.
 *
 * The port filters in JS rather than pushing `data->>'parent_id' = $n` into SQL,
 * "deliberately: the predicate must be the SAME predicate". Nothing here widens
 * that; this is the flag branch and the household resolution, and no more.
 */
export async function guardedLiveChildrenOf(db, id, { household = undefined } = {}) {
  return refusing("live-children", async () =>
    scoped(household ?? null, async (client, key) => {
      const { children } = await port.pgLiveChildrenOf(client, id, { household: key });
      return children;
    }));
}

// ═════════════════════════════════════════════════════════════════════════════
// GUARD 2 · `draftsForKey` — the signed-in draft overlay
// ═════════════════════════════════════════════════════════════════════════════
//
// THE SKETCHBOOK HALF IS NOT REPLACED, and that is the whole shape of this one.
// 1.0's `draftsForKey` is `gitDelta ∪ replayDrafts(journal)`; the flag swaps the
// SECOND half only. `DISCLOSURES.sketchbook` says why the first cannot be
// swapped: `draft/<household>` "still holds every draft written before the
// single-log flag … A resident with pre-flag sketches sees them in 1.0's answer
// and not in this one." Dropping it would make a resident's existing work vanish
// from their own overlay on the day the guard flipped — which is precisely what
// 1.0's own comment says the union exists to prevent.
//
// `pathFor` and the canon filing are INJECTED, not vendored — the port refuses
// to grow a twin of them ("a guessed path would be worse than a null one: gate A
// refuses a mark filed at the wrong place at the next lint"). This function is
// where the office hands over its own, which is exactly what the equality
// falsifier does, so the shape under test is the shape that runs.

/**
 * 1.0's `draftsForKey(repo, key)`, with the journal half answered from `claims`
 * plus the withdraw acts under the flag.
 *
 * The `log` block keeps meaning what it meant — "what the journal contributes is
 * disclosed in its own `log` block rather than smuggled into a field that
 * already means a commit" — and gains `source`, so a reader can tell which store
 * answered without reading the flag.
 */
export async function guardedDraftsForKey(repo, key) {
  const journal = await import("./world-journal.mjs");
  const branches = await import("./world-branches.mjs");
  const gitDelta = branches.draftDeltaForKey(repo, key);
  if (gitDelta?.error) return gitDelta;

  const name = branches.resolvedWorldHousehold(key);
  let replayed;
  try {
    const state = branches.publishedState(repo).state ?? {};
    const publishedIds = new Set((state.marks ?? []).map((m) => m.id));
    const sha = String(gitDelta.main ?? branches.mainRef(repo));
    const publishedPathOf = journal.filedPathOfAt(repo, sha);
    const canonById = new Map((state.marks ?? []).map((m) => [m.id, m]));
    const publishedMarkOf = (id) => canonById.get(id) ?? null;

    replayed = await refusing("draft-overlay", async () =>
      scoped(name, (client, key2) => port.pgDraftsForKey(client, {
        household: key2,
        // The withdraw acts are scoped by the OTHER spelling — `acts.household`
        // carried the office key's NAME on every row the mirror wrote. The port
        // takes both and joins through `identities`; handing it one would return
        // every added and modified mark and no deleted ones, silently.
        journalHousehold: name,
        publishedIds, publishedPathOf, publishedMarkOf,
        pathFor: journal.pathFor,
      })));
  } catch (e) {
    // 1.0's own answer to an unreadable live layer, kept verbatim in shape: the
    // sketchbook half still answers and the block says what is missing from it.
    // This is NOT the permissive direction — the overlay is a READ a resident
    // sees, not a gate that lets a write through — so the door tells the truth
    // rather than refusing a page.
    return { ...gitDelta, log: { readable: false, source: "acts", reason: String(e?.message ?? e).slice(0, 200) } };
  }

  const byId = new Map();
  for (const m of gitDelta.marks ?? []) if (m.id) byId.set(m.id, m);
  for (const m of replayed.marks) if (m.id) byId.set(m.id, m);
  const marks = [...byId.values()].sort((a, b) => String(a.path).localeCompare(String(b.path)));

  return {
    ...gitDelta,
    exists: gitDelta.exists || marks.length > 0,
    marks,
    counts: {
      added: marks.filter((m) => m.status === "added").length,
      modified: marks.filter((m) => m.status === "modified").length,
      deleted: marks.filter((m) => m.status === "deleted").length,
    },
    log: { readable: true, source: "claims", head: null, marks: replayed.marks.length },
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// GUARD 3 · `liveHolder` / `readAttachments` — give/drop/take's holder check
// ═════════════════════════════════════════════════════════════════════════════
//
// `declareHolding` is the PURE ADJUDICATOR — "it takes a db and no key, it is
// tested directly on hand-built stores" — and world-hold.mjs's own header gives
// the reason nothing async may go inside it. So the rows are read HERE and
// handed in, which is the same argument the mirror and the loot shroud already
// won at that door.
//
// The read is NOT household-scoped: `acts` holds holdings for the whole town and
// 1.0's `readAttachments(db)` is the whole record too — "narrowing it to one
// target would change the answer, not just the cost."

/**
 * 1.0's `readAttachments(db)`, answered from `acts` (both eras) under the flag.
 *
 * `strict: true` again, and here it is the sharpest of the three: the port's own
 * refusal text says a skipped holding act "would answer with the WRONG RESIDENT
 * holding a thing, which is the one answer this door exists to get right."
 */
export async function guardedAttachments(db, { until = null } = {}) {
  if (!guardsFlipped()) {
    const { readAttachments } = await import("./dynamic-entities.mjs");
    return readAttachments(db, { until });
  }
  return refusing("holder", async () =>
    reading(async (client) => {
      const { rows } = await port.pgAttachmentsFor(client, { until });
      return rows;
    }));
}

// ═════════════════════════════════════════════════════════════════════════════
// THE HOLD SHELF'S READS · no flag, one source (POS-153)
// ═════════════════════════════════════════════════════════════════════════════
//
// The two functions below are NOT guards. A guard adjudicates a write and is
// allowed a flag while its port is proven; these are plain reads that used to
// open sqlite and now read the record, and Everything Reads the Store says the
// flag is the disease — "one question, one owner". So there is no
// `guardsFlipped()` branch here and no sqlite fallback underneath: a store that
// cannot be reached THROWS, and each of the three callers turns that into the
// answer it has always given for an unreadable record (POS-153 finding 5).
//
// ⚑ NOT WRAPPED IN `refusing`, and the section below is where that argument is
// written out in full: `GuardsUnreachableError` carries the PEN's sentence —
// "nothing was written, and nothing was lost" — which is the wrong thing to say
// about a read that wrote nothing by construction. So the port's own error
// travels and each caller's catch turns it into ITS ruled answer. It matters
// more here than at the stands block, because these callers give THREE
// DIFFERENT answers to one unreadable record (empty lists · `[]` ·
// `{ readable: false, reason }`): a wrapper rewriting the error would have left
// all three intact while saying something false about the pen on the way past.
//
// They sit in this file because `reading` and `refusing` do — the read worker's
// road (`officeRead`: one pooled connection, `BEGIN READ ONLY`, released) is
// DEC-4's whole guarantee that a read worker holds no writable handle, and a
// second pool opened beside it would be the fourth copy of a word this office
// already knows four times.
//
// ⚑ `world2Enabled` HERE IS NOT A SOURCE SWITCH. There is no second source to
// switch to. It is the question "is there a record to reach at all" — `pool()`
// builds its pg.Pool from `WORLD2_PG_URL`, so an office with none would spend a
// socket timeout discovering that on every read. `actsQuery` already draws this
// exact line ("`null` means 'not asked'; `[]` means 'asked, and the answer is
// none'"), and every arm of it lands on the same three refusal answers an
// unreachable pool does.

const unconfigured = (which) => {
  if (world2Enabled()) return null;
  return new GuardsUnreachableError(which,
    new Error("WORLD2_PG/WORLD2_PG_URL are unset — this office is not pointed at the record"));
};

/**
 * `readJournal(db, { cls: "holding" })`, from the record. Oldest first.
 *
 * `since` / `until` are crossing bounds, both optional and both pushed only
 * when finite (the port's own § explains why that IS the equality).
 */
export async function storeHoldingRows({ thing = null, since = null, until = null } = {}) {
  const off = unconfigured("holding");
  if (off) throw off;
  return reading(async (client) => port.pgHoldingRows(client, { thing, since, until }));
}

/**
 * THE SET-DOWNS WAITING ON A HOUSE'S WORD — the holding record's rows for the
 * things `handles` made, in ONE read-only transaction (POS-138, 2026-09-24).
 *
 * Answers `Map(thing -> { attachments, journal })`: exactly the envelope
 * `standsRowsFromStore` answers for one thing, so `world-stance.mjs §
 * setDownFor` reads it through its own `readRows` seam and stays the one place
 * that decides whether a set-down is a stranger's. This function decides
 * nothing: it enumerates.
 *
 * WHAT IT READS: the holding acts on things these handles made (one query,
 * `pgHoldingRows`' `madeBy` narrowing), then the attachment acts of each of
 * those things that has a drop on the record (one query per such thing). A
 * thing never set down costs no second query. Null when the office is not
 * pointed at the record, which is "I could not look", never "nothing waits".
 */
export async function setDownRowsForMakers(handles) {
  if (!world2Enabled()) return null;
  const makers = [...new Set([...(handles ?? [])].map(String).filter(Boolean))].sort();
  if (!makers.length) return new Map();
  return reading(async (client) => {
    const journal = await port.pgHoldingRows(client, { madeBy: makers });
    const byThing = new Map();
    for (const r of journal) {
      const thing = String(r.object ?? r.payload?.thing ?? "");
      if (!thing) continue;
      if (!byThing.has(thing)) byThing.set(thing, []);
      byThing.get(thing).push(r);
    }
    const out = new Map();
    for (const [thing, rows] of [...byThing].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      if (!rows.some((r) => r.action === "drop")) continue;
      const held = await port.pgAttachmentsFor(client, { target: thing });
      out.set(thing, { attachments: held.rows, journal: rows });
    }
    return out;
  });
}

/**
 * `readAttachments(db)`, from the record — the whole town's edge, never
 * narrowed, for `pgAttachmentsFor`'s own reason: "narrowing it to one target
 * would change the answer, not just the cost."
 *
 * ⚑ RETURNS THE ARRAY, NOT THE PORT'S ENVELOPE. `readAttachments` answers a
 * bare array and `pgAttachmentsFor` answers `{ rows, refusals, eras }`; handing
 * the envelope to `holdingsOf` would throw inside a caller whose catch answers
 * `[]`, so "you are holding nothing" would ship green. The unwrap is here, once,
 * rather than at each of the three call sites.
 *
 * `guardedAttachments` above still carries its flag: it is the WRITE guard, its
 * port is row 29 of the reader inventory and its flip is not this lane's. Both
 * call the same `pgAttachmentsFor` underneath, so there is one answer with two
 * doors to it, and the doors collapse when row 29 lands.
 */
export async function storeAttachmentRows({ until = null } = {}) {
  const off = unconfigured("holder");
  if (off) throw off;
  return reading(async (client) => {
    const { rows } = await port.pgAttachmentsFor(client, { until });
    return rows;
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// NOT A GUARD · the town's departure record, read from the store
// ═════════════════════════════════════════════════════════════════════════════
//
// POS-154, under Everything Reads the Store. `world-movement.mjs §
// storedDepartures` opened `dynamic.db` and folded the `movements` table for
// `GET /world/orient`, `/world/present`, `/world/walkers` and the say door's
// earshot. The rows are in `acts`, the derivation exists, and this is the wire —
// the same shape and the same reasons as the stands block below, so the two sit
// together rather than growing a second road apiece.
//
// ⚑ THE FOUNDING ERA IS EXCLUDED, and it is the one clause that cannot be left
// out. `DEPARTURE_ACTIONS` matches the backfilled walk ledger too, and era one
// ALREADY reaches every one of those callers by another road entirely —
// `world.mjs § departuresAcrossEras` parses `WORLD/walk-ledger.md` out of the
// clone and merges the two itself. Returning `_ledger` rows here would hand that
// merge the founding era twice, and `recordsAcrossEras`' own de-dupe could not
// see it: `dedupeRecords` keys on `era`, the clone's copy is stamped `ledger` and
// this one would be stamped `store`, so both survive and the LAST one wins. That
// is not a duplicate row in a list; it is a different resident's governing leg.
//
// ⚑ ONE CONVERTER, WHICH IS `live-reads`'. `departureRecordOf` reads all four
// pens (ledger / journal / live / movement-store) and REFUSES a row it cannot
// read rather than skipping it. Writing the mapping again here is the thing
// every file in this derivation forbids about itself, and a second copy would
// drift on exactly the pen nobody is looking at.
//
// ⚑ `strict` STAYS ON. A refused act throws out of `departureRecords`, this
// throws, and `storedDepartures` turns it into a named `absent` — which is the
// same bargain the sqlite read kept, where a payload that would not parse landed
// in its catch. An answer short by the rows nobody looks for is the one outcome
// neither store is allowed to produce.
//
// ⚑ NO FLAG. `guardedAttachments` carries a `W2_GUARDS` branch because a GUARD
// flipping is a thing an operator rolls back. This is a READ with one right
// answer, and a switch here would be the office keeping two answers to one
// question — the thing the project exists to stop.
export async function storeDepartureRows() {
  const off = unconfigured("departures");
  if (off) throw off;
  return reading(async (client) => {
    const live = await import("../world2/tools/live-reads.mjs");
    const { rows } = await client.query(
      `SELECT id, at, crossing, actor, action, payload FROM acts
        WHERE action = ANY($1) AND payload->>'_ledger' IS NULL ${live.DEPARTURE_ORDER_SQL}`,
      [live.DEPARTURE_ACTIONS]);
    // `assertDepartureOrder` runs inside this — the 44-handle `ORDER BY id` trap
    // stays a refusal by name rather than a quietly wrong governing leg, and it
    // still has something to say with era one filtered out: ids must ascend.
    return live.departureRecords(rows);
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// NOT A GUARD · the investigate door's `stands` block, read from the store
// ═════════════════════════════════════════════════════════════════════════════
//
// POS-162, under Everything Reads the Store. `world.mjs § thingStandsBlock` used
// to open `dynamic.db` read-only for BOTH halves of a holder question — the
// `attachments` table and the holding-class `journal`. The rows are in `acts`,
// the ports exist, and this is the wire.
//
// ⚑ IT TAKES NO FLAG, AND THAT IS THE POINT. `guardedAttachments` above carries
// a `W2_GUARDS` branch because a GUARD flipping is a thing an operator rolls
// back by removing a flag. This is a READ with one right answer: the holding
// record lives in `acts`, the sqlite journal truncates at every drain, and a
// switch here would be the office maintaining two answers to one question —
// which is the thing the project exists to stop. Replace, never layer: there is
// no sqlite fallback under this and a store that cannot be read is an ABSENT
// block, which is the door's own ruled answer for an unreadable record.
//
// ⚑ ONE TRANSACTION, BOTH HALVES. `officeRead`'s `BEGIN READ ONLY` wraps the
// pair, so the holder and the set-down are read from one snapshot rather than
// from two the town may have moved between — and it is one round trip, not two.
//
// ⚑ DEC-4 GETS STRONGER, NOT WEAKER. The rule is that a read worker holds no
// writable handle; the old road held a read-only sqlite handle and closed it in
// a `finally`. This road opens no sqlite handle at all, and `BEGIN READ ONLY`
// makes "this never writes" a property Postgres enforces rather than one a
// comment asserts.
//
// ⚑ NOT WRAPPED IN `refusing`. `GuardsUnreachableError` carries the PEN's
// sentence — "nothing was written, and nothing was lost" — which is the wrong
// thing to say about a read that wrote nothing by construction. The caller's
// ruled answer for an unreadable record is an absent block, and it reaches that
// answer from any throw. So the port's own error travels, and the door's catch
// is the one place it becomes an answer.

/**
 * Both halves of a holder question for ONE thing, from `acts`, in the shapes
 * `world-hold.mjs § whereThingStands` already takes.
 *
 * `attachments` is narrowed to this target in SQL — the port offers it and says
 * why it is safe ("`liveHolder` reads the last row FOR THAT TARGET, so a
 * filtered read is safe, while a filtered read that also dropped the order would
 * not be"), and both of this door's consumers filter by the same id anyway.
 *
 * Returns `null` when the register is not configured, which is `actsQuery`'s own
 * distinction: null is "I could not look", never "the answer is none".
 */
export async function standsRowsFromStore(thingId) {
  if (!world2Enabled()) return null;
  return reading(async (client) => {
    const [held, holding] = await Promise.all([
      port.pgAttachmentsFor(client, { target: String(thingId) }),
      port.pgHoldingRowsFor(client, String(thingId)),
    ]);
    return { attachments: held.rows, journal: holding.rows };
  });
}

/** What the doors say about the read half, for the status surfaces. */
export function guardStatus(env = process.env) {
  return { flipped: guardsFlipped(env), flag: "W2_GUARDS", source: guardsFlipped(env) ? "postgres" : "sqlite" };
}
