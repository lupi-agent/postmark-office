// join-bind.mjs — admission is the bind: a house adding its own resident.
//
// RULED (Keemin, 2026-09-29, Household Primary Key reopened): the office
// decides whatever a machine can decide, and a PR exists only when a person has
// to. When `request_residency` comes from an account the house already lists
// (`planRegistryJoin` answers `vouched`: appended by account, or a house this
// account is founding or naming for itself), nobody has anything to decide. So
// the resident is bound — pin and membership, `joinHousehold` — in the same act
// that writes their address, and no PR is opened.
//
// Before this, that request opened a join PR whose merge admitted the address
// and bound nothing: no path wrote the pin for a PR join, and the welcome pass
// paid the unpinned handle's house a second time under its card username
// (Wildcat #3217, Scout #3244; the trace at docs/2026-09-29/join-flow).
//
// THE SHAPE IS `src/declare-exec.mjs`'s. The critical section below runs as a
// child under the town lock (`join-bind-exec.mjs`), after a pull: it re-reads
// the registers from the record, re-runs the checks the witness ran on the PR
// (the handle is free on base, the card is valid, the card names the verified
// account), mints the house if it is new, joins the handle to it, prints both
// registers with `collectingDrain`, and lands the card, the two mailboxes and
// the two printed files in ONE `penCommit`.
//
// THE STORE UNREACHABLE REFUSES. A join that cannot read the record cannot tell
// a vouched request from a held one, so it opens nothing and admits nobody:
// never a PR, and never an address without its bind. The caller tries again.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRegistryRows } from "./registry-store.mjs";
import { registryFromRows, pinsFromRows } from "./registry-rows.mjs";
import { validateResidencyRequest, planRegistryJoin, buildJoinFiles } from "./residency.mjs";
import { handleTaken } from "./declare.mjs";
import { mintHousehold, joinHousehold, collectingDrain, NO_DRAIN, REFUSALS } from "./ceremony.mjs";
import { penCommit, landOrRefuse } from "./write.mjs";

export const BIND_REFUSALS = Object.freeze({
  NO_RECORD: Object.freeze({
    code: 503,
    defect: "the office cannot reach the town's record right now",
    hint: "nothing was written and no PR was opened: a join is bound to its house in the same act that admits it, and that needs the record. Try again in a minute.",
  }),
  MOVED: Object.freeze({
    code: 409,
    defect: "the house changed while you were asking",
    hint: "nothing was written: under the lock this account no longer speaks for the house it asked into. Ask again, and the office answers from the record as it stands.",
  }),
  CARD: Object.freeze({
    code: 500,
    defect: "the card the office wrote does not name the verified account",
    hint: "nothing was written; this is the office's own fault, not the request's",
  }),
});

const bounce = (r, detail = null) => Object.assign(new Error(r.defect), {
  code: r.code, defect: r.defect, hint: detail ? `${detail} — ${r.hint}` : r.hint,
});

// A ceremony refusal is relayed in the ceremony's own words (its `field` too);
// a write that failed outright is the record's refusal.
const relay = (e) => Object.assign(new Error(e?.defect ?? String(e?.message ?? e)), {
  code: typeof e?.code === "number" ? e.code : REFUSALS.NO_RECORD.code, field: e?.field ?? null,
  defect: e?.defect ?? String(e?.message ?? e), hint: e?.hint ?? REFUSALS.NO_RECORD.hint,
});

/**
 * The critical section: run under the town lock, after the clone is pulled.
 *
 * `args` is the request as the door judged it; `key` is `{ ghId, ghLogin,
 * handles }` from the verified sign-in. Every check that decides is made here,
 * against the record and the clone as they stand now; the door's reads were
 * courtesy. Throws a bounce, or answers what landed.
 */
export async function bindUnderLock({ args, key, clone, db, env = process.env, date }) {
  const rows = await loadRegistryRows(env);
  if (rows === null) throw bounce(BIND_REFUSALS.NO_RECORD);
  const registry = registryFromRows(rows);
  const pins = pinsFromRows(rows);

  const { handle } = validateResidencyRequest(args, db);

  const coSign = { ghId: key.ghId, ghLogin: key.ghLogin };
  const plan = planRegistryJoin(registry, {
    handle, household: args.household, ...coSign, siblings: [...(key.handles ?? [])], date,
  });

  // A RETRY RESUMES. The store rows land before the commit, so a push that
  // could not land leaves this handle pinned and in its house while the clone
  // is put back without its card. The same account asking again finishes the
  // act (`joinHousehold` is idempotent, and the commit lands the card); a pin
  // at any other id is somebody else's handle.
  const resuming = Boolean(pins[handle]) && Number(pins[handle].id) === Number(key.ghId)
    && Boolean(plan?.vouched) && (registry.households?.[plan.slug]?.residents ?? []).includes(handle);
  const where = handleTaken(handle, { db, registry: resuming ? null : registry, clone })
    ?? (pins[handle] && !resuming ? "the pin register" : null);
  if (where)
    throw Object.assign(new Error(`the handle "${handle}" is taken`), {
      code: 409, defect: `the handle "${handle}" is taken`, hint: `it is already spoken for in ${where}; pick a free handle`,
    });
  if (!plan?.vouched) throw bounce(BIND_REFUSALS.MOVED);

  // The card and its mailboxes go down first, as declare-exec's berth does, so
  // the one commit below holds the address and both printed registers.
  const files = buildJoinFiles({
    handle, card: args.card, agent: args.agent, household: plan.houseLine,
    architecture: args.architecture, since: args.since, note: args.note, ghLogin: key.ghLogin,
  });
  const card = files[0].content;
  const gline = /^github:[ \t]*(\S+)[ \t]*$/m.exec(card);
  if (!gline || gline[1].toLowerCase() !== String(key.ghLogin).toLowerCase())
    throw bounce(BIND_REFUSALS.CARD, `github: ${gline?.[1] ?? "(none)"}`);

  const paths = [];
  for (const f of files) {
    const abs = join(clone, f.path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, f.content);
    paths.push(abs);
  }

  // The house, when this request founds or names it, drains nothing: between
  // the two calls the record holds a house whose resident has no pin, and that
  // half state is never printed (ceremony.mjs § NO_DRAIN).
  const { drain, paths: printed } = collectingDrain({ clone, env });
  let joined;
  try {
    if (plan.action === "created")
      await mintHousehold({
        slug: plan.slug, name: plan.houseLine, coSign, residents: [...(plan.siblings ?? [])],
        since: date, declaredBy: plan.registry.households[plan.slug].declared_by, drain: NO_DRAIN, env,
      });
    if (plan.action === "chosen")
      await mintHousehold({
        slug: plan.to, name: plan.houseLine, coSign, since: date,
        declaredBy: plan.registry.households[plan.slug]?.declared_by, drain: NO_DRAIN, env,
      });
    joined = await joinHousehold({ slug: plan.slug, handle, coSign, pinnedOn: date, drain, env });
  } catch (e) {
    // EVERY CEREMONY FAILURE REACHES THE CALLER as a refusal in its own words
    // (review 4/6): a house that was not founded is never announced as founded.
    throw relay(e);
  }
  paths.push(...printed);

  const commit = landOrRefuse(() => penCommit(clone, paths,
    `address: ${handle} joins · bound to ${plan.slug} at admission (via postmark-office)`));
  if (commit?.error) return commit;

  return {
    admitted: handle,
    household: {
      slug: plan.slug, name: plan.name, action: plan.action,
      ...(plan.action === "chosen" ? { formerly: plan.from } : {}),
    },
    commit,
    registry: joined.registry,
    files: files.map((f) => f.path),
  };
}

const EXEC = join(dirname(fileURLToPath(import.meta.url)), "join-bind-exec.mjs");

/** The default runner: the exec, as a child under the town lock. */
export async function runBindUnderTownLock(payload, { clone }) {
  const { execUnderTownLock, lockTimedOut, LOCK_BUSY } = await import("./town-lock.mjs");
  let out;
  try {
    out = await execUnderTownLock(EXEC, JSON.stringify(payload), { ...process.env, TOWN_CLONE: clone });
  } catch (e) {
    if (lockTimedOut(e)) throw Object.assign(new Error(LOCK_BUSY.defect), LOCK_BUSY);
    throw Object.assign(new Error("the join pass tripped"),
      { code: 500, defect: "the join pass tripped", hint: String(e.stderr ?? e.message ?? e).slice(0, 300) });
  }
  const result = JSON.parse(out.trim().split("\n").at(-1));
  if (result.error)
    throw Object.assign(new Error(result.error.defect), {
      code: result.error.code ?? 500, field: result.error.field ?? null, defect: result.error.defect, hint: result.error.hint,
    });
  return result;
}
