// ops.mjs — the principal's desk (gold plan postmark-ops-desk).
//
// v1 tool: gift stamps to a resident. The office does NOT reimplement minting —
// it triggers the town's OWN tools/stamp-mint.mjs --gift under the ferry's
// flock, the exact ceremony the hand-run does (fix-the-class: the CLI stays the
// single mint law). Mirrors the stake lane (votes.mjs / stake-exec.mjs). The
// principal check is the wall; the /ops/ site page is only presentation.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execUnderTownLock, lockTimedOut, LOCK_BUSY } from "./town-lock.mjs";
import { listRoles, roleCheck } from "./roles.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// ── THE PRINCIPAL IS A ROLE ROW (POS-352, Darko 2026-10-04) ─────────────────
//
// Principal = the request's VERIFIED GitHub id holds the `principal` role in
// the role registry (`office_roles` in the store since POS-271's switch 1).
// Until POS-352 it was the env line `PRINCIPAL_GH_ID` in
// /etc/postmark-office.env: an identity fact kept in a file the store never
// saw. The store is the record now, so the env line is retired; the role is
// granted once by the operator's desk:
//
//   node tools/roles.mjs grant --gh-id <the founder's id> --role principal \
//     --note "POS-352: the principal leaves the env file"
//
// Static keys carry no ghId → never principal (the OAuth GitHub sign-in is the
// gate), exactly as before.
//
// TWO READS, BY WHAT THEY GUARD. The one door that SPENDS on the principal's
// word (POST /ops/gift) asks the registry per call (`principalNow`): a revoke
// lands at the next call. The flags that only DESCRIBE a session (`/me`'s and
// whoami's `principal: true`, read synchronously by composed reads) read a set
// the office reloads from the same registry every minute (`loadPrincipals`);
// before the first load it is empty, so nobody is described as principal.
export const ROLE_PRINCIPAL = "principal";

let principals = new Set();

/** The subjects (gh_id digit strings) holding the principal role, as last loaded. */
export const principalSubjects = () => principals;

/** Reload the set from the registry. A failed read keeps the last good set. */
export async function loadPrincipals(rdb) {
  const rows = await listRoles(rdb, { role: ROLE_PRINCIPAL });
  principals = new Set((rows ?? []).map((r) => String(r.subject)));
  return principals;
}

/** Load now and every `everyMs`; answers the stop function. Never throws. */
export function startPrincipalRefresher(rdb, { everyMs = 60_000 } = {}) {
  const tick = () => loadPrincipals(rdb).catch(() => { /* keep the last good set */ });
  tick();
  const t = setInterval(tick, everyMs);
  t.unref?.();
  return () => clearInterval(t);
}

/** Test seam: hand the module a set of subjects. Never used by the office. */
export function __setPrincipalsForTest(subjects) { principals = new Set([...(subjects ?? [])].map(String)); }

/**
 * Is this key the principal's? Against `subjects` (default: the loaded set;
 * a single id or a list is accepted, for a caller that knows the answer).
 */
export function isPrincipal(key, subjects = principals) {
  const set = subjects instanceof Set ? subjects : new Set(subjects == null ? [] : [].concat(subjects).map(String));
  return key?.ghId != null && set.has(String(key.ghId));
}

/** The authoritative answer, read from the registry now (the spending door's). */
export async function principalNow(rdb, key) {
  return (await roleCheck(rdb, key?.ghId ?? null, ROLE_PRINCIPAL)).ok === true;
}

export function townDay() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: process.env.TOWN_TZ ?? "America/New_York" }).format(new Date());
}

// POST /ops/gift — mint a founder gift to a resident. Runs gift-exec.mjs as a
// subprocess under the ferry's flock (linux); direct on dev/test. `by:` and
// `date` are server-derived from the verified principal + the town clock, never
// from the body. Returns the mint result or throws { code, defect, hint }.
export async function giftViaOffice(clone, { handle, amount, slug }, key) {
  const bounce = (code, defect, hint) => { const e = new Error(defect); Object.assign(e, { code, defect, hint }); return e; };
  if (!handle || amount === undefined || amount === null || !slug)
    throw bounce(422, "incomplete gift", "required: handle, amount, slug");
  const n = Number(amount);
  if (!Number.isInteger(n) || n < 1)
    throw bounce(422, "amount must be a whole number ≥ 1", `got "${amount}"`);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug))
    throw bounce(422, "slug must be kebab-case", `lowercase letters, digits, single hyphens — got "${slug}"`);

  const exec = join(HERE, "gift-exec.mjs");
  // by: keemin — the single principal (decision 4); the ledger's own convention.
  const payload = JSON.stringify({ handle, amount: n, slug, by: "keemin", date: townDay() });
  const env = { ...process.env, TOWN_CLONE: clone };
  let out;
  try {
    out = await execUnderTownLock(exec, payload, env);
  } catch (e) {
    if (lockTimedOut(e)) throw bounce(LOCK_BUSY.code, LOCK_BUSY.defect, LOCK_BUSY.hint);
    const msg = String(e.stderr ?? e.message ?? e).slice(0, 300);
    throw bounce(500, "the gift pass tripped", msg);
  }
  const result = JSON.parse(out.trim().split("\n").at(-1));
  if (result.error) throw bounce(result.error.code ?? 500, result.error.defect, result.error.hint);
  return result;
}
