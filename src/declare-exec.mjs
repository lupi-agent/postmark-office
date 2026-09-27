// declare-exec.mjs — the town-writing half of a household declaration.
//
// Invoked by declareViaOffice() as a subprocess (on the box: wrapped in
// `flock -w 30 town.lock`, the same lock the ferry chain and the gift pass
// hold — a declaration can never race a crossing, and two declarations can
// never interleave their writes to tools/households.json). Does the whole
// critical section in one process: pull the clone, re-read the two registers
// FRESH under the lock, re-run conformance against them, write the file set,
// commit + push with the pen's ceremony. Prints exactly one JSON line.
//
// Why conformance runs twice: the door checks it to answer fast and to bounce
// with a named field, but that read happened outside the lock. Between then and
// now another declaration may have taken the handle or the household name. The
// check inside the lock is the one that decides — the first is courtesy, the
// second is law. Uniqueness is only true if it is true when you write.
//
// Env: TOWN_CLONE, TOWN_PUSH=1, BOT_NAME/BOT_EMAIL (penCommit's), TOWN_TZ.
// argv[2]: JSON { args, key } — the caller's declaration and their verified key.
//
// Exit 0 with the plan result or { error: { code, field, defect, hint } } (a
// bounce is an answer); exit 1 only when the machinery itself trips.

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { penCommit } from "./write.mjs";
import { conformance, planDeclaration, readRegisters, LANDING_GROUND } from "./declare.mjs";
import { gangwayState } from "./residency.mjs";
import { mintHousehold, joinHousehold, collectingDrain, NO_DRAIN } from "./ceremony.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLONE = process.env.TOWN_CLONE ?? resolve(HERE, "..", "town-clone");

const answer = (obj) => { console.log(JSON.stringify(obj)); process.exit(0); };
const err = (code, field, defect, hint) => answer({ error: { code, field, defect, hint } });

async function main() {
  const { args, key, dbPath } = JSON.parse(process.argv[2] ?? "{}");

  if (!existsSync(CLONE))
    return err(409, null, "not-yet-open", "the office has no town clone to declare into");

  // Freshen first: the registers we are about to check must be the ones the
  // town holds, not the ones this clone happened to hold last crossing.
  if (process.env.TOWN_PUSH === "1")
    execFileSync("git", ["-C", CLONE, "pull", "--rebase", "-q"], { encoding: "utf8" });

  const db = new DatabaseSync(dbPath ?? process.env.OFFICE_DB ?? resolve(HERE, "..", "office.db"), { readOnly: true });

  // THE REGISTERS, FROM THE RECORD, UNDER THE LOCK (POS-158). These two lines
  // used to read the clone's JSON files with an `?? {}` fallback. The registry
  // is store-of-record now, and the fallback was the more dangerous half: an
  // unreadable file became "no households exist", against which every slug is
  // free — so the check that runs INSIDE the lock, the one this whole file
  // exists to run, would have waved through a duplicate of a live house.
  // `readRegisters` refuses on an unreachable record instead.
  let registry, pins;
  try {
    ({ registry, pins } = await readRegisters());
  } catch (e) {
    return err(e.code ?? 503, e.field ?? null, e.defect, e.hint);
  }

  // The deciding check — inside the lock, against the freshened registers. A
  // key arriving here is already GitHub-verified by the door; we re-check the
  // whole list anyway rather than trusting the earlier pass.
  let decl;
  try {
    decl = conformance(args, { db, registry, clone: CLONE, key });
  } catch (e) {
    return err(e.code ?? 422, e.field ?? null, e.defect, e.hint);
  }

  // The gangway is re-read HERE, under the lock, against the clone we just
  // freshened — not carried in from the door's earlier read. Settling at the
  // door (POS-178) made this door a settlement road, and a breaker that is read
  // outside the lock is a breaker a race can walk past: the founder's commit
  // raising the gangway may have arrived in the pull above. Same reason
  // conformance runs twice — the check inside the lock is the one that decides.
  const plan = planDeclaration(registry, pins, decl, { gangway: gangwayState(CLONE) });

  // Berth + registry entry + identity pin — and, for a household settling at
  // the door, its white-pages file set — go down together and are staged
  // together, so the single commit below is the atomicity: all or none. A
  // household standing in the registry whose credential resolves to nobody is
  // precisely the state this must never produce, and so is an address card with
  // no row behind it. Adding the settlement to `plan.files` bought that
  // guarantee for free: it is the same list, the same staging, the same commit.
  const paths = [];
  for (const f of plan.files) {
    const abs = join(CLONE, f.path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, f.content);
    paths.push(abs);
  }

  // ── THE MINT, HERE, UNDER THE LOCK (POS-158) ─────────────────────────────
  //
  // THE CO-SIGN IS THIS ACT. `conformance` check 11 refuses a declaration
  // without `key.ghId`, so a declaration reaching this line is anchored to a
  // verified GitHub account by construction — and the berth co-sign lane
  // (`src/oauth.mjs § berth-cosign`) arrives here too, carrying the HUMAN's
  // verified identity from the one click. One mint serves both paths because
  // both walk this exec.
  //
  // WHY HERE AND NOT IN `declareHousehold`. The ruling says the house is minted
  // at the co-sign, at the door; this IS that door's writing half, and it is
  // the only half that holds the town flock. The door's own conformance ran
  // outside the lock and is courtesy — "uniqueness is only true if it is true
  // when you write", this file's own words. A mint in the parent process would
  // write a house row against a check the lock may overturn a moment later, and
  // leave a row with no card behind it.
  //
  // TWO ROWS, ONE DRAIN. The house first, then the membership — and the house's
  // mint drains NOTHING (`NO_DRAIN`), because between the two calls the record
  // holds a house whose first resident has no pin, and publishing that half
  // state into the town's history is precisely the broken covenant this file's
  // atomicity paragraph above refuses.
  //
  // ONE COMMIT, STILL. `collectingDrain` writes the two registry files and
  // hands back their paths instead of committing them, so they are staged
  // beside the berth and the address card and go down in the SINGLE
  // `penCommit` below. The guarantee the paragraph above bought for free is
  // unchanged: all or none, and there is no window in which a household holds
  // an address and no registry row.
  const { drain, paths: drainedPaths } = collectingDrain({ clone: CLONE });
  let registryOutcome = { rendered: true };
  try {
    await mintHousehold({
      slug: plan.slug,
      name: decl.household,
      coSign: { ghId: decl.ghId, ghLogin: decl.ghLogin },
      residents: [decl.handle],
      since: plan.date,
      memberOf: LANDING_GROUND,
      declaredBy: plan.registry.households[plan.slug].declared_by,
      drain: NO_DRAIN,
    });
    const joined = await joinHousehold({
      slug: plan.slug,
      handle: decl.handle,
      coSign: { ghId: decl.ghId, ghLogin: decl.ghLogin },
      pinnedOn: plan.date,
      drain,
    });
    // THE DRAIN'S OUTCOME RIDES THE ANSWER (review 6/6). `drainRegistry`
    // refuses rather than shrink the registry, and the row still landed — so
    // the house IS founded while the town's two files are one crossing behind,
    // a state only a person can clear. Silence there told the resident
    // everything landed; this says which half did.
    registryOutcome = joined.registry;
  } catch (e) {
    return err(e.code ?? 500, e.field ?? null, e.defect ?? String(e?.message ?? e), e.hint ?? null);
  }
  paths.push(...drainedPaths);

  // The subject line says which of the two things happened, because the town
  // repo's log is read by people looking for when a household came ashore.
  const commit = penCommit(CLONE, paths, plan.settled
    ? `harbor: ${decl.handle} arrives and settles ashore · household ${decl.slug} declared (via postmark-office, join-as-declaration)`
    : `harbor: ${decl.handle} arrives · household ${decl.slug} declared (via postmark-office, join-as-declaration)`);

  // `settled` rides the answer because THIS process is the authority on it: the
  // door planned against a gangway it read before the lock, and this one re-read
  // it after the pull. declareHousehold prefers this field over its own plan.
  answer({ slug: plan.slug, handle: decl.handle, commit, settled: plan.settled, gangway: plan.gangway, registry: registryOutcome, files: plan.files.map((f) => f.path) });
}

main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
