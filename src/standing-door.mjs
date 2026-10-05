// standing-door.mjs — the Registrar writes standing through the office (POS-347).
//
//   household { do: "standing", args: { act, handle, reason, founder_word? } }
//
// RULED (Darko, 2026-10-04): the store is the record. Before this door the
// Registrar suspended a resident by committing a line to the town's
// `tools/standing-ledger.md` with `tools/registrar-audit.mjs act`, and the
// office read that file. Now the act is a row in `standing_acts` (060), written
// here, and the file is rendered from the store in the same pen commit
// (tools/standing-drain.mjs). The town CLI still works: a line it commits is
// adopted by the next drain (the store reads git), so nothing the Registrar
// already knows how to do stops working on the day this ships.
//
// ── WHO MAY CALL IT ─────────────────────────────────────────────────────────
//
// The Registrar, with wright as backup: the list settle-join holds and for the
// same reason (src/settle-join.mjs § WHO MAY CALL IT). An operator act, so it
// is unlisted (household-apex.mjs § OPERATOR_ACTS): to any other key it answers
// as a name the door has never heard of. `by:` on the line is the caller's own
// handle from that list, never a field the caller supplies.
//
// ── WHAT IT CHECKS (the town's planAct, verbatim in substance) ──────────────
//
//   · act is quarantine, lift or revoke; handle is well formed;
//   · a reason, with no `·` (the separator is the parse);
//   · a REVOKE needs the founder's word, quoted verbatim, always; and lifting a
//     REVOCATION needs it too — the stronger act takes the stronger hand in
//     both directions;
//   · a lift needs a current suspension (a no-op lift reads as a real act later);
//   · quarantine and revoke need a resident: a handle in a household of the
//     store's registry (019), the record of who lives here;
//   · the line it would write parses back to itself.
//
// Every refusal names itself and writes nothing. The checks against current
// standing run UNDER THE TOWN LOCK, after the file's own lines are adopted, so
// two acts cannot both pass against the same stale standing.
//
// ── A LOST PUSH RESUMES ─────────────────────────────────────────────────────
//
// The row lands in the store before the pen commits (lesson 30: a store write
// survives the clone's rollback). The same call again finds its line already
// held (`line` is UNIQUE), answers `recorded: false, already: true`, and drains
// the file; the next keep tick drains it regardless.

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTS, STANDING_HANDLE_RE, formatStandingLine, parseStandingLine, isSuspended, STANDING_LEDGER_PATH,
} from "./standing.mjs";
import { standingForHandles, insertStandingActs } from "./standing-store.mjs";
import { loadRegistryRows } from "./registry-store.mjs";

export const STANDING_CALLERS = Object.freeze(["registrar", "wright"]);

export function callerMayStand(key) {
  const held = key?.handles ?? new Set();
  return STANDING_CALLERS.some((h) => held.has(h));
}

/** The caller's own hand, in list order: the Registrar when the key holds her. */
export const callerHand = (key) => STANDING_CALLERS.find((h) => (key?.handles ?? new Set()).has(h)) ?? null;

export const STANDING_REFUSALS = Object.freeze({
  ACT: { code: 422, defect: "`act` must be quarantine, lift or revoke", hint: "household { do: \"standing\", args: { act, handle, reason } }" },
  HANDLE: { code: 422, defect: "`handle` must be a well-formed resident handle", hint: "lowercase letters, digits and single hyphens — every act is about somebody" },
  REASON: { code: 422, defect: "a standing act needs a `reason`", hint: "a suspension with no stated cause is exactly the thing this ledger exists to prevent" },
  SEPARATOR: { code: 422, defect: "a field holds `·`", hint: "that character is the ledger's separator; say it another way" },
  FOUNDER_WORD: { code: 422, defect: "revocation requires `founder_word`", hint: "the founder's own sentence, quoted verbatim. Revocation is never automatic and no default may stand in for that word" },
  LIFT_REVOKED: { code: 422, defect: "lifting a revocation requires `founder_word`", hint: "the same hand that took it" },
  NOTHING_TO_LIFT: { code: 409, defect: "there is nothing to lift", hint: "a no-op lift row reads as a real act later" },
  NOT_RESIDENT: { code: 409, defect: "no resident by that handle in the record", hint: "standing is a thing only a resident can have — a join that has not settled is the harbor's business" },
  NO_RECORD: { code: 503, defect: "the office cannot reach the town's record", hint: "nothing was written; a standing act is a row in the record, so it waits until the record answers" },
  UNPARSED: { code: 409, defect: "the town's standing ledger holds a line its grammar cannot read", hint: "the current standing is not knowable, so nothing was written — a person fixes the line first" },
  ROUND_TRIP: { code: 500, defect: "the line this act would write does not parse back to itself", hint: "nothing was written" },
});

const refuse = (r, detail = null) => Object.assign(new Error(r.defect), {
  code: r.code, defect: r.defect, hint: detail ? `${detail} — ${r.hint}` : r.hint,
});

const clean = (s) => (s == null ? "" : String(s).replace(/[\r\n]+/g, " ").trim());

export const townDate = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: process.env.TOWN_TZ ?? "America/New_York" }).format(now);

/** The fields judged on their own, before the lock: a record, or a throw. */
export function judgeStandingFields(fields, key, { date = townDate() } = {}) {
  const act = clean(fields?.act).toLowerCase();
  if (!ACTS.includes(act)) throw refuse(STANDING_REFUSALS.ACT);
  const handle = clean(fields?.handle).toLowerCase();
  if (!handle || !STANDING_HANDLE_RE.test(handle)) throw refuse(STANDING_REFUSALS.HANDLE);
  const reason = clean(fields?.reason);
  if (!reason) throw refuse(STANDING_REFUSALS.REASON);
  const founderWord = clean(fields?.founder_word) || null;
  if (reason.includes("·") || (founderWord ?? "").includes("·")) throw refuse(STANDING_REFUSALS.SEPARATOR);
  if (act === "revoke" && !founderWord) throw refuse(STANDING_REFUSALS.FOUNDER_WORD);
  const by = callerHand(key);
  if (!by) throw new Error("standing reached without its caller gate");
  const record = { date, act, handle, by, founderWord, reason };
  record.line = formatStandingLine(record);
  const back = parseStandingLine(record.line);
  if (!back || back.act !== act || back.handle !== handle || back.reason !== reason || (back.founderWord ?? "") !== (founderWord ?? ""))
    throw refuse(STANDING_REFUSALS.ROUND_TRIP, record.line);
  return record;
}

/**
 * Judge the act against the record as it stands NOW (call under the lock,
 * after the file's lines are adopted). Throws a named refusal, or answers the
 * handle's previous standing (null when nothing was ever said).
 */
export async function judgeAgainstRecord(record, { env = process.env } = {}) {
  const standing = await standingForHandles([record.handle], env);
  if (standing === null) throw refuse(STANDING_REFUSALS.NO_RECORD);
  const current = standing.get(record.handle) ?? null;
  if (record.act === "lift") {
    if (!isSuspended(current))
      throw refuse(STANDING_REFUSALS.NOTHING_TO_LIFT,
        current ? `"${record.handle}" is already clear (lifted ${current.since})` : `"${record.handle}" has never been suspended`);
    if (current.state === "revoked" && !record.founderWord)
      throw refuse(STANDING_REFUSALS.LIFT_REVOKED, `"${record.handle}" is REVOKED, not quarantined`);
  } else {
    const rows = await loadRegistryRows(env);
    if (rows === null) throw refuse(STANDING_REFUSALS.NO_RECORD);
    const lives = rows.households.some((h) => (h.residents ?? []).includes(record.handle));
    if (!lives) throw refuse(STANDING_REFUSALS.NOT_RESIDENT, `"${record.handle}"`);
  }
  return current;
}

/**
 * The critical section, under the town lock: adopt the file's own lines, judge
 * against the record, append the row, render the file in one pen commit.
 * `drain` and `adopt` are injected so a test runs it without a clone or a pen.
 */
export async function standingUnderLock({ record, actor = null, clone, env = process.env, drain = null, adopt = null }) {
  const tools = (!drain || !adopt) ? await import("../tools/standing-drain.mjs") : null;
  adopt ??= tools.adoptFromGit;
  drain ??= tools.drainStanding;
  const a = await adopt({ clone, env });
  if (a.skipped) throw refuse(STANDING_REFUSALS.NO_RECORD);
  if (a.refused) throw refuse(STANDING_REFUSALS.UNPARSED, a.refused);
  const already = (a.records ?? []).some((r) => r.line === record.line);
  let previous = null;
  let inserted = [];
  if (!already) {
    previous = await judgeAgainstRecord(record, { env });
    inserted = await insertStandingActs([record], { source: "door", actor }, env);
    if (inserted === null) throw refuse(STANDING_REFUSALS.NO_RECORD);
  }
  const d = await drain({ clone, env, note: `${record.act} ${record.handle} by ${record.by} through the office door (household { do: "standing" })` });
  return {
    ok: true,
    act: record.act,
    handle: record.handle,
    line: record.line,
    recorded: inserted.length === 1,
    already,
    previous: previous ? { state: previous.state, since: previous.since } : null,
    ledger: STANDING_LEDGER_PATH,
    commit: d.commit ?? null,
    drained: d.ran ? (d.changed ? "rendered" : "unchanged") : (d.refused ?? d.skipped ?? "not run"),
    note: "the store is the record (standing_acts); the town's file is its export, and every write door reads the store on its next call",
  };
}

const EXEC = join(dirname(fileURLToPath(import.meta.url)), "standing-exec.mjs");

async function runUnderTownLock(payload, { clone }) {
  const { execUnderTownLock, lockTimedOut, LOCK_BUSY } = await import("./town-lock.mjs");
  let out;
  try {
    out = await execUnderTownLock(EXEC, JSON.stringify(payload), { ...process.env, TOWN_CLONE: clone });
  } catch (e) {
    if (lockTimedOut(e)) throw Object.assign(new Error(LOCK_BUSY.defect), LOCK_BUSY);
    throw Object.assign(new Error("the standing act tripped"),
      { code: 500, defect: "the standing act tripped", hint: String(e.stderr ?? e.message ?? e).slice(0, 300) });
  }
  const result = JSON.parse(out.trim().split("\n").at(-1));
  if (result.error)
    throw Object.assign(new Error(result.error.defect), { code: result.error.code ?? 500, defect: result.error.defect, hint: result.error.hint });
  return result;
}

/**
 * The door: `household { do: "standing", args: { act, handle, reason, founder_word? } }`.
 * `run` is the locked critical section, injected in tests.
 */
export async function standingAtOffice(fields, key, { clone, run = runUnderTownLock } = {}) {
  if (!callerMayStand(key)) throw new Error("standing reached without its caller gate");
  const record = judgeStandingFields(fields, key);
  return run({ record, actor: key?.household ?? null }, { clone });
}
