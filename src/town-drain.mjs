// town-drain.mjs — the town's settlement: join rows become the durable record.
//
// WHERE IT RUNS. The ferry's crossing, 00:00 and 12:00 UTC (tools/ferry.mjs in
// the town repo). POS-44's fourth design-in: "Two repos, two drains: FERRY
// CROSSINGS are the town record's settlement (join rows drain at 00:00/12:00
// into WHITE_PAGES + registry), world rows keep the settlement drain — one law,
// two cadences."
//
// It is OFFICE-SIDE CODE THE FERRY INVOKES, not a step written in the town repo,
// and that follows from where the two halves live: the rows are office state in
// dynamic.db, the record is the town clone. The office already crosses that gap
// the same way for declares — through the pen (declare-exec under the town lock)
// — so this composes the same pieces rather than opening a second road.
//
// WHAT IT WRITES, and the discipline that makes it trustworthy: NOTHING OF ITS
// OWN. The three files come from residency.mjs's `buildJoinFiles` and the
// membership judgment from its `planRegistryJoin`. Since POS-158 the registry
// is not a file this drain writes at all: it writes the ROWS, through
// `src/ceremony.mjs § joinHousehold`, and `tools/registry-drain.mjs` renders
// the town's two files from the record in the same act.
// The drain-side equivalence the round was held to is not a test that two
// implementations agree — there is only one implementation, and the drain is a
// second CALLER of it. A row's drain output is what the pen lane would have
// written because it is literally the same function, modulo the ceremony (a PR,
// a human merging) that the pivot removed.
//
// APPENDS ONLY — THE TULIP LAW. POS-44's third design-in, verbatim: "Registry
// writes are APPENDS: dated ledger registry: lines + row additions in the drain
// commit, never restatements (replay stays green)". A retroactive edit to a
// registry line turns the ledger's replay red, because the replay recomputes
// identity-over-time from the lines in order; restating one rewrites history the
// signatures were taken over. So this appends a dated `registry:` line and adds
// rows; it never rewrites one.
//
// PARCELS AND GROUND ARE NOT TOUCHED. Settling mints an address and a registry
// row. Ground is the world's, drained on the world's own cadence, and a join has
// never implied a parcel.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";

import {
  buildJoinFiles, gangwayState, planRegistryJoin,
} from "./residency.mjs";
// The record's readers and the ceremony (POS-158). `ceremony.mjs` is safe to
// import statically here: it reaches `residency.mjs` through
// `tools/registry-drain.mjs`, and nothing in that graph reaches back to this
// file, so there is no cycle to close.
import { loadRegistry } from "./registry-store.mjs";
import { mintHousehold, joinHousehold, collectingDrain, NO_DRAIN } from "./ceremony.mjs";
import {
  ensureTownJournal, pendingRows, rowIsSettleable, townDrainCursor, TOWN_DRAIN_CURSOR, SETTLE_THRESHOLD,
} from "./town-journal.mjs";

// ── THE GANGWAY REACHES THE SETTLEMENT ROAD ────────────────────────────────
//
// HARBOR/GANGWAY.md is the town's circuit breaker on ARRIVALS, and until this
// it was wired only to the lane the cutover retires. tools/settle.mjs refuses
// unless `state: open`, residency.mjs § requestResidency boards a berth instead
// of joining while frozen — and this planner, the road that replaces both under
// TOWN_SINGLE_LOG, never opened the file. So a founder could raise the gangway
// and a crossing would settle join rows straight past it. The breaker was on
// the old pipe.
//
// It is read from the SAME place, the same way, live per crossing: no cache, so
// a founder commit flipping the state costs a pull and not a restart. Absent
// file = open, which is residency.mjs's own answer — a town with no HARBOR has
// no freeze.
//
// JOINS ONLY, AND THAT IS A CHOICE. The gangway is the ARRIVALS breaker: its
// own law is about who comes ashore, and mail and paper have their own controls
// (WORLD_FREEZE for ground acts, the standing ledger for a suspended resident,
// the ferry's own envelope law for a letter). A frozen gangway that also
// stopped the town's mail would be a second, undeclared policy hiding inside a
// one-word file. So letters and paper acts drain through a raised gangway
// exactly as they did.
//
// `waiting`, NEVER `skipped`. The two piles mean different things and the
// difference is the whole fix: skipped rows are JUDGED AND DONE, waiting rows
// are "not yet, and nothing is lost" (the tier line built that pile). A frozen
// crossing is precisely the second one — the row is lawful, its household is
// real, and the only thing wrong with it is the hour.
export const GANGWAY_HELD = (state) =>
  `the gangway is ${state} (HARBOR/GANGWAY.md) — the town is not taking arrivals, so this row settles when it lowers; nothing about it expires and nothing is lost by waiting`;

// The other `waiting` sentence, and it belongs to the same pile for the same
// reason: the row is lawful, its household is real, and the only thing wrong
// with it is that this office could not reach the record this minute.
/** A membership write that could not reach the record — same pile, same promise. */
export const STORE_WRITE_FAILED = (e) =>
  `this office could not write the town's record for this row (${String(e?.defect ?? e?.message ?? e).slice(0, 160)}) — `
  + "nothing was written for it and it is still pending; the next crossing settles it. "
  + "Nothing about it expires and nothing is lost by waiting.";

export const UNREACHABLE_RECORD =
  "this office could not read the town's record at this crossing, so nothing was settled and nothing was written — the row is still pending and the next crossing settles it; nothing about it expires and nothing is lost by waiting";

/**
 * What this crossing WOULD settle, decided before anything is written.
 *
 * Split from the writing on purpose: the plan is pure and testable, and the
 * ferry can ask what a crossing would do without a clone that can be committed
 * to. Every row lands in exactly one of three piles, and the third is the one
 * the founder's tier line creates.
 */
export async function planTownDrain(odb, clone, { date }) {
  const rows = pendingRows(odb);
  // THE REGISTRY, FROM THE RECORD (POS-158). This used to read the clone's
  // `tools/households.json` with an `?? { households: {} }` fallback, and that
  // fallback was the dangerous half: against an empty registry every account is
  // unknown and every house is available, so a crossing would fold `created`
  // over rows whose houses already stand and mint duplicates of live rows —
  // over the WHOLE pending log at once, unattended, at 00:00 UTC.
  //
  // `null` is therefore a refusal and not an emptiness. A crossing that cannot
  // read the roll settles NOBODY and holds its cursor: every row stays pending
  // and the next crossing, against a reachable record, settles them in their
  // own order. Nothing is lost by waiting, which is the same shape the gangway
  // already puts held rows in.
  const registry = await loadRegistry();
  if (registry === null)
    return {
      settle: [], waiting: rows.filter((r) => r.act === "declare-household" || r.act === "request-residency")
        .map((row) => ({ row, why: UNREACHABLE_RECORD })),
      skipped: [], plans: [], registry: null, unreachable: true,
      gangway: { state: gangwayState(clone), held: 0 },
      head: rows.length ? rows[rows.length - 1].seq : townDrainCursor(odb),
    };
  const gangway = gangwayState(clone);
  const gangwayOpen = gangway === "open";

  const settle = [], waiting = [], skipped = [];
  const claimed = new Set();
  let held = 0;

  for (const row of rows) {
    if (row.act !== "declare-household" && row.act !== "request-residency") { skipped.push({ row, why: `not a settling act: ${row.act}` }); continue; }
    if (!row.handle) { skipped.push({ row, why: "no handle on the row" }); continue; }

    // THE BREAKER, before every other judgment about this row — a raised
    // gangway is not a fact about the row, it is a fact about the town, and a
    // row held by it should say so rather than say something truer of itself.
    if (!gangwayOpen) { held += 1; waiting.push({ row, why: GANGWAY_HELD(gangway) }); continue; }

    // THE TIER LINE (the founder, 2026-08-24): auto-settle drains ONLY rows
    // anchored to a verified GitHub identity — the immutable id — or a human
    // co-sign. An unverified row is NOT refused and NOT dropped: it stays in the
    // log, its household keeps full berth life, and it settles the moment the
    // anchor arrives. The registry invariants hang off that pin, so an
    // unverified row could not write a lawful entry even if this tried.
    if (!rowIsSettleable(row)) { waiting.push({ row, why: SETTLE_THRESHOLD }); continue; }

    // Two rows for one name inside one epoch. The door holds the name (the
    // fourth register, declare.mjs § handleTaken) so this should be
    // unreachable — and it is checked anyway, because "should be unreachable"
    // is exactly the assumption a drain must not make about its own input.
    if (claimed.has(row.handle)) { skipped.push({ row, why: `"${row.handle}" was claimed earlier in this same crossing` }); continue; }
    if (existsSync(join(clone, "WHITE_PAGES", row.handle, "ADDRESS.md"))) { skipped.push({ row, why: `"${row.handle}" already stands in the white pages` }); continue; }

    claimed.add(row.handle);
    settle.push(row);
  }

  // The registry diff, folded ONCE over the whole crossing — planRegistryJoin
  // reads the registry it is given, so each row must see the previous row's
  // effect or two joins into one household would each write it as the first.
  let working = JSON.parse(JSON.stringify(registry));
  const plans = [];
  for (const row of settle) {
    const plan = planRegistryJoin(working, {
      handle: row.handle,
      household: row.payload?.household ?? row.household,
      ghId: row.ghId, ghLogin: row.ghLogin,
      date,
    });
    plans.push({ row, plan });
    if (plan?.registry) working = plan.registry;
  }

  // `gangway.held` is a COUNT and not the state, because it is the count the
  // cursor hangs off: a raised gangway over a crossing carrying no join rows
  // holds nothing, and stalling the cursor there would stop the town's mail
  // from ever being marked drained for the length of a freeze.
  return {
    settle, waiting, skipped, plans, registry: working,
    gangway: { state: gangway, held },
    head: rows.length ? rows[rows.length - 1].seq : townDrainCursor(odb),
  };
}

/** The dated ledger line an appended registry row carries. APPEND ONLY. */
export const registryLine = (date, handle, householdSlug) =>
  `- ${date} · registry: ${handle} = hh:${householdSlug}`;

// ── THE DRAIN SIGNS WHAT IT WRITES (#2040, the third unsigned line) ─────────
//
// The stamp-ledger's grammar has required an office-pen signature on every
// assertion line since the Ember fold (town tools/stamp-mint.mjs § SEAL +
// SIGNATURE: "seal_n = sha256(seal_{n-1} + canonical(line_n))", "sig_n =
// ed25519.sign(utf8(seal_n))", "Signing the running seal means every signature
// binds the entire prefix"). This drain was the ONE ledger writer in the office
// that appended bare — fund/gift/stake/pot all sign — and each native join
// minted a line stamp-verify refuses: zeno 08-27, errant 08-28, each repaired
// by hand. On the native path the signature is the line's only authentication:
// every box commit rides one shared git credential, so the seal chain is what
// says the office's authorized writer emitted this line at this position.
//
// The seal arithmetic is the TOWN's, not ours — computed by importing the
// clone's own tools/stamp-mint.mjs in a subprocess (the same subprocess-pen
// shape the fund/gift/stake execs already are), so there is exactly one
// authority for canonical + chain and this file duplicates none of it.
// STAMP_ENGINE_DIR overrides the tools dir for fixtures whose throwaway clones
// carry no tools/ (the fund.test.mjs precedent).
export const DRAIN_KEY_PATH = () => process.env.STAMP_KEY ?? "/srv/postmark-office/stamp-key.pem";

export function signedRegistryLines(clone, bareLines) {
  const keyPath = DRAIN_KEY_PATH();
  if (!existsSync(keyPath)) {
    const e = new Error(`the ledger pen's key is absent (${keyPath}) — the drain refuses to append an unsigned registry line`);
    e.code = "pen-key-absent";
    throw e;
  }
  const engineDir = process.env.STAMP_ENGINE_DIR ?? join(clone, "tools");
  const script = [
    "const [clone, engineDir, keyPath] = process.argv.slice(1);",
    "const { readFileSync } = await import('node:fs');",
    "const { createPrivateKey, sign } = await import('node:crypto');",
    "const { pathToFileURL } = await import('node:url');",
    "const { parseStampLedger, sealChain } = await import(pathToFileURL(engineDir + '/stamp-mint.mjs'));",
    "const bare = JSON.parse(readFileSync(0, 'utf8'));",
    "const prior = parseStampLedger(readFileSync(clone + '/WHITE_PAGES/stamp-ledger.md', 'utf8')).map((e) => e.canonical);",
    "const seals = sealChain([...prior, ...bare]);",
    "const key = createPrivateKey(readFileSync(keyPath, 'utf8'));",
    "const out = bare.map((line, i) => line + ' · sig: ' + sign(null, Buffer.from(seals[prior.length + i], 'utf8'), key).toString('base64url'));",
    "process.stdout.write(JSON.stringify(out));",
  ].join("\n");
  const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", script, clone, engineDir, keyPath],
    { input: JSON.stringify(bareLines), encoding: "utf8" });
  const signed = JSON.parse(stdout);
  if (!Array.isArray(signed) || signed.length !== bareLines.length)
    throw new Error("the signing subprocess answered a shape that is not one signed line per bare line");
  return signed;
}

/**
 * Is the ledger pen ready to sign this clone's registry appends? The drain's
 * caller asks BEFORE writing anything, so a missing key is a refusal that
 * leaves every row queued and the cursor unmoved — refuse, never degrade: an
 * unsigned line is not a lesser record, it is a red the whole ledger wears.
 */
export function drainPenReady(clone) {
  if (!existsSync(join(clone, "WHITE_PAGES", "stamp-ledger.md"))) return { ready: true, note: "no ledger in this clone — nothing to sign" };
  if (!existsSync(DRAIN_KEY_PATH())) return { ready: false, why: `pen key absent at ${DRAIN_KEY_PATH()}` };
  return { ready: true };
}

/**
 * Write the crossing. Returns the paths touched, for the ferry's scoped commit.
 *
 * The cursor is NOT advanced here. The ferry commits and pushes first; a cursor
 * moved before the record is durable is the one ordering that can lose a
 * household, and it is the same discipline the world drain keeps (its truncate
 * and its cursor advance are one transaction, after the refs are written).
 */
export async function writeTownDrain(clone, plan, { date, drainWith = collectingDrain }) {
  const touched = [];
  const put = (rel, content) => {
    const abs = join(clone, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    touched.push(rel);
  };

  // THE SIGNING COMES FIRST — before a single byte lands. A key that is absent
  // or a chain that will not compute must refuse the whole crossing with the
  // clone untouched and every row still queued; a half-written crossing whose
  // ledger append then fails is the stranded shape the 08-29 noon ferry wore.
  const ledgerRel = "WHITE_PAGES/stamp-ledger.md";
  const ledgerAbs = join(clone, ledgerRel);
  let signedLedgerLines = null;
  if (plan.plans.length && existsSync(ledgerAbs)) {
    const bare = plan.plans.map(({ row, plan: p }) =>
      registryLine(date, row.handle, p?.slug ?? row.payload?.slug ?? row.household));
    signedLedgerLines = signedRegistryLines(clone, bare);
  }

  // ── THE RECORD FIRST, THE CARDS SECOND (POS-158, review 2/6) ────────
  //
  // These two blocks used to run the other way round, and the order was the
  // whole defect. A store failure between the plan and the write threw out of
  // this function, out of `runTownDrain`, out of the tool — and the ferry chain
  // is `&&`-joined, so a membership write failing stopped the TOWN'S MAIL. The
  // ruling is that a membership write must never block the town.
  //
  // Writing the record first is what makes the deferral honest rather than
  // cosmetic. With the cards written first, a failed store write left an
  // ADDRESS card standing for a resident the record cannot account for — the
  // broken covenant `src/declare-exec.mjs` names, reached by the other door.
  // Now a row that cannot reach the record produces NO bytes at all: it is
  // simply not settled this crossing, exactly like a row the gangway held.
  //
  // WHAT A FAILURE COSTS: one crossing's wait. The row stays pending, the
  // cursor is held for it (`src/town-bridge.mjs` § THE STALLED ROWS HOLD THE
  // CURSOR), the report names it under `store`, and the next crossing settles
  // it. Nothing expires and nothing is lost — the same promise the gangway's
  // held rows and the tier line's deferred rows already carry.
  const stalled = [];
  const landed = [];
  const { drain } = drainWith({ clone });

  for (const { row, plan: p } of plan.plans) {
    if (!p) { landed.push({ row, plan: p }); continue; }
    try {
      // `created` IS THE EXCEPTION AND IT IS KEPT. Almost every row reaching
      // here belongs to a house that already stands — the declare door mints at
      // its own co-sign, and so does `requestResidency`. The one road that
      // still arrives houseless is a join opened while this office could not
      // reach the record (`residency.mjs` warns and opens the PR anyway, on the
      // founder's 2026-08 call that a seam flicker must not turn anybody away).
      // That row founds its house here rather than never.
      if (p.action === "created")
        await mintHousehold({
          slug: p.slug,
          name: p.houseLine,
          coSign: { ghId: row.ghId, ghLogin: row.ghLogin },
          // The siblings only — `joinHousehold` on the next line adds this
          // row's own handle, so the two calls compose to the plan's
          // `[...siblings, handle]` and the mint means the same thing here as
          // it does at the door (`src/residency.mjs` § THE HOUSE FOUNDS
          // HOLDING ITS SIBLINGS).
          residents: [...(p.siblings ?? [])],
          since: date,
          declaredBy: p.registry.households[p.slug].declared_by,
          drain: NO_DRAIN,
        });
      // `chosen` TAKES THE SAME ROAD, AND FOR THE SAME ONE REASON (POS-197). A
      // provisional house's human chooses its key at the door, at the co-sign
      // (`requestResidency`), and by the time the Registrar merges, the record
      // already holds the chosen key and this plan comes back `appended`. The
      // row that still arrives here `chosen` is the flicker road again: the
      // door could not read the record, so the house did not choose there. It
      // chooses here rather than never, through the same ceremony.
      //
      // A HOUSE THAT ALREADY CHOSE IS NOT REFUSED HERE. At the door that
      // refusal is the answer; at the crossing the Registrar has already
      // admitted this resident, and a refusal would stall the row — and hold
      // the cursor — on every crossing forever over a nameplate. So an
      // `already` plan mints nothing and joins the house under the key it chose
      // (`p.slug` is that key for an `already` plan), which is what `appended`
      // did before this branch existed.
      else if (p.action === "chosen" && !p.already)
        await mintHousehold({
          slug: p.to,
          name: p.houseLine,
          coSign: { ghId: row.ghId, ghLogin: row.ghLogin },
          since: date,
          declaredBy: p.registry.households[p.slug].declared_by,
          drain: NO_DRAIN,
        });
      await joinHousehold({
        slug: p.slug,
        handle: row.handle,
        coSign: { ghId: row.ghId, ghLogin: row.ghLogin },
        pinnedOn: date,
        drain: NO_DRAIN,
      });
      landed.push({ row, plan: p });
    } catch (e) {
      // NAMED, NEVER SWALLOWED. The sentence is the row's own `why`, in the
      // same shape `planTownDrain` gives an unreachable record, so an operator
      // reading the report cannot tell which half of the crossing deferred it
      // and does not need to.
      stalled.push({ row, why: STORE_WRITE_FAILED(e) });
    }
  }

  for (const { row } of landed) {
    // The pen lane's own three files, from the pen lane's own function.
    for (const f of buildJoinFiles({
      handle: row.handle,
      card: row.payload?.card ?? "",
      household: row.payload?.household ?? row.household,
      ghLogin: row.ghLogin,
      agent: row.payload?.agent,
      architecture: row.payload?.architecture,
      since: row.payload?.since,
      note: row.payload?.note,
    })) put(f.path, f.content);
  }

  if (landed.length) {
    // ONE DRAIN FOR THE WHOLE CROSSING, after the last row that landed — so the
    // town's history carries one registry commit per crossing, exactly as it
    // did when this was a single `put(REGISTRY_PATH, …)`, rather than one per
    // settled resident. Every mint above defers (`NO_DRAIN`) for that reason.
    const drained = await drain();
    // A REFUSED DRAIN IS NOT A SILENT ONE. `drainRegistry` refuses rather than
    // shrink the registry (its § THE DRAIN NEVER SHRINKS), and a crossing that
    // wrote its rows into the record and then could not render them must say
    // so where a person reads it — the ferry's report — rather than return a
    // short list of touched paths that looks like an ordinary quiet crossing.
    if (drained?.refused) touched.refused = drained.refused;
    for (const rel of drained?.changed ?? []) touched.push(rel);
    // and the ledger's appended lines — one per settled resident, dated, SIGNED
    // (#2040: the bare append was the office's one unsigned ledger writer; the
    // seal chain is the clone's own stamp-mint's, computed above, before any write).
    //
    // ONE LINE PER ROW THAT ACTUALLY LANDED. The lines are signed before any
    // byte is written (§ THE SIGNING COMES FIRST), over the WHOLE plan, so a
    // row that stalled at the store has a signed line here that must NOT be
    // appended: the ledger is append-only and replayed, and a `registry:` line
    // for a resident the record does not hold would turn that replay red at the
    // next crossing. They are selected by position against `plan.plans`, which
    // is the order they were signed in.
    if (signedLedgerLines) {
      const keep = new Set(landed.map(({ row }) => row.seq));
      const lines = signedLedgerLines.filter((_, i) => keep.has(plan.plans[i].row.seq));
      if (lines.length) {
        const prior = readFileSync(ledgerAbs, "utf8");
        writeFileSync(ledgerAbs, prior.replace(/\s*$/, "\n") + lines.join("\n") + "\n");
        touched.push(ledgerRel);
      }
    }
  }
  // The stalled rows ride OUT, on the array, for the same reason `refused`
  // does: `runTownDrain` is what holds the cursor and writes the report, and a
  // deferral that did not reach it would be a row dropped under a sentence
  // promising it was kept.
  if (stalled.length) touched.stalled = stalled;
  return touched;
}

/**
 * Advance the cursor — the ferry calls this AFTER its commit and push.
 *
 * It ensures its own table first. That is not belt-and-braces: `meta` is not
 * part of the office's oauth.db, which is where the town log actually lives, so
 * before wave 4 every caller of this function was a test whose fixture had
 * created `meta` by hand and the live path would have thrown here — at the last
 * step of a crossing, with the record already written and pushed. A function
 * that writes a cursor is the right owner of the table the cursor sits in.
 */
export function advanceTownCursor(odb, head) {
  ensureTownJournal(odb);
  odb.prepare("INSERT OR REPLACE INTO meta VALUES (?, ?)").run(TOWN_DRAIN_CURSOR, String(head));
}
