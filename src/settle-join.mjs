// settle-join.mjs — the Registrar settles a merged pen join (town #3231).
//
// RULED (Keemin, 2026-09-28, postmark-town/postmark#3231): the join PR stays a
// REQUEST and never again carries edits to the pins or households files; the
// database is the one writer. The Registrar settles merged pen joins as part
// of her audit, through one narrow office door:
//
//   household { do: "settle-join", args: { handle } }
//
// WHY THIS DOOR EXISTS. Since POS-158 the pen's join PR carries only the
// address, and the pin and the membership were meant to land at the crossing
// that follows the merge. No path writes them for a PR join: the residency
// door logs no town-journal row (none of `requestResidency`'s callers passes
// `{ odb }`), and the town drain skips a handle whose ADDRESS already stands
// (`src/town-drain.mjs`, "already stands in the white pages"). Wildcat (#3217)
// was bound by hand on 2026-09-28. This door is the hand, named.
//
// WHAT IT CHECKS, and each refusal is its own sentence (`SETTLE_REFUSALS`):
//   · the caller's key holds one of `SETTLE_JOIN_CALLERS` (checked at the
//     household apex, which answers anyone else as it answers an act it has
//     never heard of — the door is unlisted and does not advertise itself);
//   · the handle has no pin in the record yet (a pinned handle answers
//     "already settled" and nothing is written — the idempotent re-call);
//   · its join PR was opened by the office pen from `residency/<handle>` and
//     is MERGED;
//   · the PR body carries the pen's verified-identity block;
//   · the handle has an ADDRESS on town main (read under the lock, after the
//     pull — the office clone lags its pull cron, so a join the Registrar has
//     just merged must not be refused off a stale clone);
//   · the card's `household:` names a house in the record whose accounts
//     already include the verified id. That is the vouch, re-checked NOW
//     against the record, never trusted from the PR. An account the house
//     never listed is a person's call, and the door refuses it.
//
// THE ACT IS THE CEREMONY ITSELF: `joinHousehold` (src/ceremony.mjs), under
// the town lock the way `src/declare-exec.mjs` runs it. The pin and the
// membership land in one act, and the registry drain re-renders
// `tools/github-ids.json` and `tools/households.json` from the record in one
// pen commit. The door never writes either file by hand.
//
// OUT OF SCOPE (the ruling): no webhook, no timer, and never a join whose PR
// is not the pen's.

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRegistryRows } from "./registry-store.mjs";
import { registryFromRows, pinsFromRows } from "./registry-rows.mjs";
import { HANDLE_RE, joinBranch, houseForName, ghFetch } from "./residency.mjs";
import { joinHousehold } from "./ceremony.mjs";

// ── WHO MAY CALL IT ─────────────────────────────────────────────────────────
//
// Named by the ruling (#3231, Keemin 2026-09-28; the list as Wright ruled it
// the same day): the Registrar, with wright as backup. The check is "the key
// holds one of these handles", as world.mjs § ON_BEHALF_PLACERS checks its
// placers. Both handles are pinned to the founder's account in his household,
// so a founder's key standing as either is the founder's own hand — which is
// why there is no separate founder entry.
export const SETTLE_JOIN_CALLERS = Object.freeze(["registrar", "wright"]);

// The office pen's immutable GitHub id. The town's witness keys pen-opened
// joins on the same number (town `tools/witness.mjs` § PEN_ID), and the
// earpiece signs its letters as the same account (`src/earpiece-mail.mjs`
// § PEN_KEY). An id, never a login: a login can be recycled.
export const PEN_GH_ID = 301406700;

export const SETTLE_REFUSALS = Object.freeze({
  HANDLE: { code: 422, defect: "settle-join needs the handle whose join merged", hint: "household { do: \"settle-join\", args: { handle: \"<handle>\" } }" },
  NO_RECORD: { code: 503, defect: "the office cannot reach the town's record", hint: "nothing was written; the pin and the membership are rows in the record, so the join waits until the record answers" },
  NO_PEN: { code: 503, defect: "not-yet-open", hint: "this office has no pen token, so it cannot read the join PR back — nothing was written" },
  GITHUB: { code: 502, defect: "the pen couldn't read the town's PRs", hint: "nothing was written; try again shortly" },
  NO_PR: { code: 409, defect: "no join PR for this handle", hint: "a merged pen join opens from the branch residency/<handle>; nothing was written" },
  NOT_PEN: { code: 409, defect: "this join was not opened by the office pen", hint: "settle-join settles only the pen's joins (immutable id 301406700); a hand-made join carries its own binding and a person reads it" },
  NOT_MERGED: { code: 409, defect: "the pen's join PR has not merged", hint: "the merge is the Registrar's admission; settle-join binds a join only after it" },
  NO_IDENTITY: { code: 409, defect: "the join PR carries no verified-identity block", hint: "the pen always writes one (`**Verified via GitHub sign-in:** `@login` (immutable id `n`)`); its absence is the finding, and a person reads the PR" },
  NO_ADDRESS: { code: 409, defect: "the handle has no ADDRESS on town main", hint: "settle-join binds a join the Registrar has merged; the card is what the merge put there" },
  NO_HOUSE: { code: 409, defect: "the card's household: names no house in the record", hint: "the join names the house it belongs to on its ADDRESS card; a house the record does not hold is a person's call" },
  NOT_VOUCHED: { code: 409, defect: "the house has never listed this account", hint: "the verified account is not one of that house's accounts, so nothing proves it speaks for the house — a person's call (a sibling vouches by letter)" },
});

const refuse = (r, detail = null) => Object.assign(new Error(r.defect), {
  code: r.code, defect: r.defect, hint: detail ? `${detail} — ${r.hint}` : r.hint,
});

export function callerMaySettle(key) {
  const held = key?.handles ?? new Set();
  return SETTLE_JOIN_CALLERS.some((h) => held.has(h));
}

// ── THE PEN'S IDENTITY BLOCK ────────────────────────────────────────────────
//
// The witness's own parse, vendored (town `tools/witness.mjs` §
// penJoinJudgment): the id from `immutable id <n>`, the login from the
// `**Verified via GitHub sign-in:**` line. The pen writes this block from the
// OAuth session (`src/residency.mjs` § joinBody), which is why it is trusted
// exactly when the PR's author is the pen. If the witness's parse changes,
// this one changes with it.
export function penIdentity(body) {
  const text = String(body ?? "");
  const idM = text.match(/immutable id\s*[`']?(\d+)/i);
  const loginM = text.match(/\*\*Verified via GitHub sign-in:\*\*\s*`@([\w-]+)`/i) || text.match(/`@([\w-]+)`\s*\(immutable id/i);
  if (!idM || !loginM) return null;
  return { ghId: Number(idM[1]), ghLogin: loginM[1] };
}

/**
 * The handle's merged pen join, read through the pen's own client.
 * Throws the named refusal when there is none.
 */
export async function findPenJoin(pen, handle) {
  const branch = joinBranch(handle);
  const r = await ghFetch(pen, "GET",
    `/repos/${pen.owner}/${pen.repo}/pulls?state=all&per_page=100&head=${encodeURIComponent(`${pen.owner}:${branch}`)}`);
  if (!r.ok) throw refuse(SETTLE_REFUSALS.GITHUB, `listing the join PRs answered ${r.status}`);
  const prs = (Array.isArray(r.json) ? r.json : []).filter((p) => p?.head?.ref === branch);
  if (!prs.length) throw refuse(SETTLE_REFUSALS.NO_PR, `no PR from ${branch}`);
  const pens = prs.filter((p) => Number(p?.user?.id) === PEN_GH_ID);
  if (!pens.length) throw refuse(SETTLE_REFUSALS.NOT_PEN, `#${prs[0].number} was opened by @${prs[0].user?.login ?? "?"}`);
  const merged = pens.filter((p) => p.merged_at).sort((a, b) => String(b.merged_at).localeCompare(String(a.merged_at)));
  if (!merged.length) throw refuse(SETTLE_REFUSALS.NOT_MERGED, `#${pens[0].number} is ${pens[0].state}`);
  const pr = merged[0];
  const who = penIdentity(pr.body);
  if (!who) throw refuse(SETTLE_REFUSALS.NO_IDENTITY, `#${pr.number}`);
  return { pr: pr.number, ...who };
}

// The card's `household:` line, read from its frontmatter only.
function cardHousehold(text) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text ?? ""));
  const m = fm && /^household:[ \t]*(.*)$/m.exec(fm[1]);
  return m ? m[1].trim() : null;
}

function alreadySettled(handle, pin, registry) {
  const slug = Object.entries(registry.households ?? {}).find(([, h]) => (h.residents ?? []).includes(handle))?.[0] ?? null;
  return {
    settled: false,
    already_settled: true,
    handle,
    pin: { handle, login: pin.login, gh_id: pin.id, pinned: pin.pinned ?? null },
    house: slug ? { slug, name: registry.households[slug].name ?? slug } : null,
    note: `${handle} already has a pin in the record — nothing was written`,
  };
}

/**
 * The critical section: run under the town lock, after the clone is pulled.
 * Every check that decides is made HERE, against the record and the clone as
 * they stand now; the door's earlier reads were courtesy.
 */
export async function settleUnderLock({ handle, ghId, ghLogin, pr, clone, env = process.env, date, drain, drainOptions = {}, adopt } = {}) {
  const h = String(handle ?? "").trim().toLowerCase();
  if (!existsSync(join(clone, "WHITE_PAGES", h, "ADDRESS.md"))) throw refuse(SETTLE_REFUSALS.NO_ADDRESS, `WHITE_PAGES/${h}/ADDRESS.md`);

  const rows = await loadRegistryRows(env);
  if (rows === null) throw refuse(SETTLE_REFUSALS.NO_RECORD);
  const registry = registryFromRows(rows);
  const pins = pinsFromRows(rows);
  if (pins[h]) return alreadySettled(h, pins[h], registry);

  const line = cardHousehold(readFileSync(join(clone, "WHITE_PAGES", h, "ADDRESS.md"), "utf8"));
  const slug = line ? houseForName(registry, line) : null;
  if (!slug) throw refuse(SETTLE_REFUSALS.NO_HOUSE, `the card says household: ${line ?? "(nothing)"}`);
  const house = registry.households[slug];

  // THE VOUCH, BY THE IMMUTABLE ID. The ruling's words: "the account must still
  // be one of that house's accounts". `joinHousehold` would APPEND an unlisted
  // account, which is right at a door where the account is the caller's own and
  // wrong here, where the caller is the Registrar acting on somebody else's
  // join — so the refusal comes before the ceremony is reached.
  const listed = (house.accounts ?? []).some((a) => a?.id != null && Number(a.id) === Number(ghId));
  if (!listed) throw refuse(SETTLE_REFUSALS.NOT_VOUCHED, `${slug} lists ${(house.accounts ?? []).map((a) => `@${a.login}`).join(", ") || "no account"}, not @${ghLogin} (id ${ghId})`);

  const joined = await joinHousehold({
    slug, handle: h, coSign: { ghId, ghLogin }, pinnedOn: date, env,
    ...(drain ? { drain } : {}), drainOptions: { clone, ...drainOptions },
    ...(adopt ? { adopt } : {}),
  });
  return {
    settled: true,
    handle: h,
    pin: { handle: h, login: ghLogin, gh_id: ghId, pinned: date },
    house: { slug, name: house.name ?? slug },
    pr,
    commit: joined.drained?.commit ?? null,
    registry: joined.registry,
    note: `${h} is bound to @${ghLogin} (id ${ghId}) and is a resident of ${house.name ?? slug}; both files are re-rendered from the record`,
  };
}

const EXEC = join(dirname(fileURLToPath(import.meta.url)), "settle-join-exec.mjs");

async function runUnderTownLock(payload, { clone }) {
  const { execUnderTownLock, lockTimedOut, LOCK_BUSY } = await import("./town-lock.mjs");
  let out;
  try {
    out = await execUnderTownLock(EXEC, JSON.stringify(payload), { ...process.env, TOWN_CLONE: clone });
  } catch (e) {
    if (lockTimedOut(e)) throw Object.assign(new Error(LOCK_BUSY.defect), LOCK_BUSY);
    throw Object.assign(new Error("the settle-join pass tripped"),
      { code: 500, defect: "the settle-join pass tripped", hint: String(e.stderr ?? e.message ?? e).slice(0, 300) });
  }
  const result = JSON.parse(out.trim().split("\n").at(-1));
  if (result.error)
    throw Object.assign(new Error(result.error.defect), { code: result.error.code ?? 500, defect: result.error.defect, hint: result.error.hint });
  return result;
}

/**
 * The door: `household { do: "settle-join", args: { handle } }`.
 * `run` is the locked critical section, injected in tests.
 */
export async function settleJoinAtOffice(fields, key, { pen, clone, env = process.env, run = runUnderTownLock } = {}) {
  // The apex gates before dispatch; reaching here without the gate is a
  // machinery fault, not a refusal to phrase for the caller.
  if (!callerMaySettle(key)) throw new Error("settle-join reached without its caller gate");
  const handle = String(fields?.handle ?? "").trim().toLowerCase();
  if (!handle || !HANDLE_RE.test(handle)) throw refuse(SETTLE_REFUSALS.HANDLE);

  // Courtesy, before GitHub is asked anything: a handle the record already
  // pins is settled, and a second call answers so without a write.
  const rows = await loadRegistryRows(env);
  if (rows === null) throw refuse(SETTLE_REFUSALS.NO_RECORD);
  const pins = pinsFromRows(rows);
  if (pins[handle]) return alreadySettled(handle, pins[handle], registryFromRows(rows));

  if (!pen?.token) throw refuse(SETTLE_REFUSALS.NO_PEN);
  const found = await findPenJoin(pen, handle);
  return run({ handle, ...found }, { clone, env });
}
