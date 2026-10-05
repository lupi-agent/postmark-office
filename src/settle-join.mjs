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
// AMENDED (Keemin, 2026-09-29, Household Primary Key reopened): the office
// decides whatever a machine can decide. So the office tick runs this after
// every merge (deploy/settle-pass.mjs, before the join-bundle pass), which
// overturns the "no timer" clause above; and a HAND-WRITTEN join PR settles
// too, keyed by its author's GitHub id (the API's `user.id`, never the card),
// with the card's `github:` resolving to that same id:
//   · an account already on a house → that house;
//   · an unknown account whose card names no existing house → a house is
//     minted, as the pen road does;
//   · a card naming an existing house the account is not on → refused, a
//     person's call.
// And NOTHING THE LEDGER ALREADY KNOWS UNBOUND IS BOUND HERE: a pin re-keys a
// handle's ledger lines from genesis, and for Wildcat that put two welcome
// lines in one house and stopped every office write (2026-09-28).

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRegistryRows } from "./registry-store.mjs";
import { registryFromRows, pinsFromRows } from "./registry-rows.mjs";
import { HANDLE_RE, joinBranch, houseForName, houseForAccount, planRegistryJoin, ghFetch } from "./residency.mjs";
import { mintHousehold, joinHousehold, collectingDrain, NO_DRAIN } from "./ceremony.mjs";
import { planHouseKey, appendHouseKey, houseKeyBounce, registryWith } from "./house-key.mjs";
import { penCommit, landOrRefuse } from "./write.mjs";

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
  NOT_A_JOIN: { code: 409, defect: "this PR is not a single-address join", hint: "a hand-written join adds one WHITE_PAGES/<handle>/ADDRESS.md and touches nothing outside that folder; anything else is a person's read" },
  CARD_NOT_AUTHOR: { code: 409, defect: "the card's github: is not the account that opened the PR", hint: "a hand-written join is keyed by its author's GitHub id, and the card's github: must resolve to that same id — a person reads it" },
  OTHER_HOUSE: { code: 409, defect: "the card names a house its author is not on", hint: "the account that opened the PR is not one of that house's accounts — a person's call (a sibling vouches by letter)" },
  MINTED: { code: 409, defect: "the ledger already knows this handle unbound", hint: "binding it now would re-key its ledger lines from genesis and turn stamp-verify red (Wildcat, 2026-09-28) — a person binds it with a dated ledger line" },
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
 * The handle's merged join from `residency/<handle>`, read through the pen's
 * own client: the pen's own when there is one, else a hand-written one from
 * that branch. (A hand-written join from any other branch is found by the
 * tick's pass, which lists merges rather than branches.) Throws the named
 * refusal when there is none.
 */
export async function findJoin(pen, handle) {
  const branch = joinBranch(handle);
  const r = await ghFetch(pen, "GET",
    `/repos/${pen.owner}/${pen.repo}/pulls?state=all&per_page=100&head=${encodeURIComponent(`${pen.owner}:${branch}`)}`);
  if (!r.ok) throw refuse(SETTLE_REFUSALS.GITHUB, `listing the join PRs answered ${r.status}`);
  const prs = (Array.isArray(r.json) ? r.json : []).filter((p) => p?.head?.ref === branch);
  if (!prs.length) throw refuse(SETTLE_REFUSALS.NO_PR, `no PR from ${branch}`);
  const newest = (list) => list.filter((p) => p.merged_at).sort((a, b) => String(b.merged_at).localeCompare(String(a.merged_at)))[0];
  const pens = prs.filter((p) => Number(p?.user?.id) === PEN_GH_ID);
  const pr = pens.length ? newest(pens) : newest(prs);
  if (!pr) throw refuse(SETTLE_REFUSALS.NOT_MERGED, `#${(pens[0] ?? prs[0]).number} is ${(pens[0] ?? prs[0]).state}`);
  return joinOfMergedPR(pen, pr);
}

/**
 * Which road a merged PR is, judged from the PR and its files alone.
 *   pen   the office pen's, from `residency/<handle>`; the identity is the
 *         verified block the pen wrote into the body.
 *   hand  anyone else's: it adds one `WHITE_PAGES/<handle>/ADDRESS.md` and
 *         touches nothing outside that folder; the identity is the author.
 */
export function judgeJoinPR(pr, files = []) {
  if (Number(pr?.user?.id) === PEN_GH_ID) {
    const m = /^residency\/(.+)$/.exec(String(pr?.head?.ref ?? ""));
    if (!m) throw refuse(SETTLE_REFUSALS.NOT_A_JOIN, `#${pr.number} is the pen's, from ${pr?.head?.ref}`);
    const who = penIdentity(pr.body);
    if (!who) throw refuse(SETTLE_REFUSALS.NO_IDENTITY, `#${pr.number}`);
    return { handle: m[1], road: "pen", ...who };
  }
  if (!Array.isArray(files) || files.length >= 100) throw refuse(SETTLE_REFUSALS.NOT_A_JOIN, `#${pr?.number} has too many files`);
  let handle = null;
  for (const f of files) {
    const m = /^WHITE_PAGES\/([^/]+)\/.+$/.exec(String(f?.filename ?? ""));
    if (!m || f.status !== "added") throw refuse(SETTLE_REFUSALS.NOT_A_JOIN, `#${pr.number} touches ${f?.filename} (${f?.status})`);
    if (handle && m[1] !== handle) throw refuse(SETTLE_REFUSALS.NOT_A_JOIN, `#${pr.number} touches ${handle} and ${m[1]}`);
    handle = m[1];
  }
  if (!handle || !HANDLE_RE.test(handle) || !files.some((f) => f.filename === `WHITE_PAGES/${handle}/ADDRESS.md`))
    throw refuse(SETTLE_REFUSALS.NOT_A_JOIN, `#${pr?.number} adds no ADDRESS.md`);
  if (pr?.user?.id == null) throw refuse(SETTLE_REFUSALS.NO_IDENTITY, `#${pr.number} names no author id`);
  return { handle, road: "hand", ghId: Number(pr.user.id), ghLogin: String(pr.user.login ?? "") };
}

/**
 * A merged PR, as a join settle-join can act on: its road, handle and
 * identity, and for a hand-written one the card's `github:` resolved to an id
 * and matched against the author's. Throws the named refusal otherwise.
 */
export async function joinOfMergedPR(pen, pr) {
  if (!pr?.merged_at) throw refuse(SETTLE_REFUSALS.NOT_MERGED, `#${pr?.number} is ${pr?.state}`);
  const repo = `/repos/${pen.owner}/${pen.repo}`;
  let files = [];
  if (Number(pr?.user?.id) !== PEN_GH_ID) {
    const f = await ghFetch(pen, "GET", `${repo}/pulls/${pr.number}/files?per_page=100`);
    if (!f.ok) throw refuse(SETTLE_REFUSALS.GITHUB, `reading #${pr.number}'s files answered ${f.status}`);
    files = f.json;
  }
  const found = judgeJoinPR(pr, files);
  if (found.road === "pen") return { pr: pr.number, ...found };

  const c = await ghFetch(pen, "GET", `${repo}/contents/WHITE_PAGES/${found.handle}/ADDRESS.md?ref=${pr.merge_commit_sha}`);
  if (!c.ok) throw refuse(SETTLE_REFUSALS.GITHUB, `reading #${pr.number}'s card answered ${c.status}`);
  const cardLogin = cardGithub(Buffer.from(String(c.json?.content ?? ""), "base64").toString("utf8"));
  if (!cardLogin) throw refuse(SETTLE_REFUSALS.CARD_NOT_AUTHOR, `#${pr.number}'s card carries no github: line`);
  const u = await ghFetch(pen, "GET", `/users/${encodeURIComponent(cardLogin)}`);
  if (!u.ok && u.status !== 404) throw refuse(SETTLE_REFUSALS.GITHUB, `resolving @${cardLogin} answered ${u.status}`);
  if (!u.ok || Number(u.json?.id) !== found.ghId)
    throw refuse(SETTLE_REFUSALS.CARD_NOT_AUTHOR, `github: ${cardLogin} is ${u.ok ? `id ${u.json.id}` : "no account"}; #${pr.number} was opened by @${found.ghLogin} (id ${found.ghId})`);
  return { pr: pr.number, ...found, cardLogin };
}

// A line of the card's frontmatter, read from its frontmatter only.
function cardField(text, field) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text ?? ""));
  const m = fm && new RegExp(`^${field}:[ \\t]*(.*)$`, "m").exec(fm[1]);
  return m ? m[1].trim() : null;
}
const cardHousehold = (text) => cardField(text, "household");
const cardGithub = (text) => cardField(text, "github")?.replace(/^@/, "") || null;

// Does the ledger hold lines for this handle that a bind would re-key? A handle
// with a MINT line and no signed `registry: <handle> = gh:<id>` line naming this
// same id is filed under its card username, and a pin applies from genesis
// (town tools/stamp-mint.mjs § householdKeys; the tulip class the town clock's
// pinner skips for the same reason).
export function ledgerKnowsUnbound(clone, handle, ghId) {
  let ledger;
  try { ledger = readFileSync(join(clone, "WHITE_PAGES", "stamp-ledger.md"), "utf8"); } catch { return false; }
  if (!ledger.includes(`· MINT → ${handle} ·`)) return false;
  let sealed = null;
  for (const m of ledger.matchAll(/· registry: ([a-z0-9._-]+) = gh:(\d+) · sig:/g))
    if (m[1] === handle) sealed = Number(m[2]);
  return sealed !== Number(ghId);
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
export async function settleUnderLock({ handle, ghId, ghLogin, pr, road = "pen", cardLogin = null, clone, env = process.env, date, adopt } = {}) {
  const h = String(handle ?? "").trim().toLowerCase();
  if (!existsSync(join(clone, "WHITE_PAGES", h, "ADDRESS.md"))) throw refuse(SETTLE_REFUSALS.NO_ADDRESS, `WHITE_PAGES/${h}/ADDRESS.md`);

  const rows = await loadRegistryRows(env);
  if (rows === null) throw refuse(SETTLE_REFUSALS.NO_RECORD);
  const registry = registryFromRows(rows);
  const pins = pinsFromRows(rows);
  if (pins[h]) return alreadySettled(h, pins[h], registry);
  if (ledgerKnowsUnbound(clone, h, ghId)) throw refuse(SETTLE_REFUSALS.MINTED, `WHITE_PAGES/stamp-ledger.md mints to ${h}`);

  const card = readFileSync(join(clone, "WHITE_PAGES", h, "ADDRESS.md"), "utf8");
  const line = cardHousehold(card);
  const coSign = { ghId, ghLogin };
  let slug, founded = null, mint = null;

  if (road === "hand") {
    // THE CARD ON MAIN IS THE CARD THAT WAS RESOLVED, read again under the lock.
    if (String(cardGithub(card) ?? "").toLowerCase() !== String(cardLogin ?? "").toLowerCase())
      throw refuse(SETTLE_REFUSALS.CARD_NOT_AUTHOR, `the card on main says github: ${cardGithub(card) ?? "(nothing)"}`);
    // "(unstated — ask them)" is the card saying nobody has named the house.
    const named = line && !/^\(unstated/i.test(line) ? line : null;
    const byAccount = houseForAccount(registry, ghId, ghLogin);
    const byName = named ? houseForName(registry, named) : null;
    if (byName && byName !== byAccount)
      throw refuse(SETTLE_REFUSALS.OTHER_HOUSE, `the card names ${byName}; @${ghLogin} (id ${ghId}) ${byAccount ? `keeps ${byAccount}` : "is on no house"}`);
    slug = byAccount;
    if (!slug) {
      const siblings = Object.entries(pins).filter(([, p]) => Number(p.id) === Number(ghId)).map(([k]) => k);
      const plan = planRegistryJoin(registry, { handle: h, household: named, ghId, ghLogin, siblings, date });
      if (plan?.action !== "created") throw refuse(SETTLE_REFUSALS.NO_HOUSE, `the card says household: ${line ?? "(nothing)"}`);
      // The house is minted below, after its key is judged (§ THE HOUSE'S KEY).
      mint = {
        slug: plan.slug, name: plan.houseLine, coSign, residents: [...plan.siblings], since: date,
        declaredBy: `admission of ${h} by hand-written join PR #${pr} (${date}), settled by the office`,
        drain: NO_DRAIN, env, ...(adopt ? { adopt } : {}),
      };
      slug = plan.slug;
      founded = plan.name;
    }
  } else {
    slug = line ? houseForName(registry, line) : null;
    if (!slug) throw refuse(SETTLE_REFUSALS.NO_HOUSE, `the card says household: ${line ?? "(nothing)"}`);
    // THE VOUCH, BY THE IMMUTABLE ID. The ruling's words: "the account must still
    // be one of that house's accounts". `joinHousehold` would APPEND an unlisted
    // account, which is right at a door where the account is the caller's own and
    // wrong here, where the caller is the Registrar acting on somebody else's
    // join — so the refusal comes before the ceremony is reached.
    const house = registry.households[slug];
    const listed = (house.accounts ?? []).some((a) => a?.id != null && Number(a.id) === Number(ghId));
    if (!listed) throw refuse(SETTLE_REFUSALS.NOT_VOUCHED, `${slug} lists ${(house.accounts ?? []).map((a) => `@${a.login}`).join(", ") || "no account"}, not @${ghLogin} (id ${ghId})`);
  }

  // THE HOUSE'S KEY, JUDGED BEFORE THE FIRST ROW (#3429): the pin lands with
  // the joiner's `registry: <handle> = hh:<slug>` line and one for every
  // housemate still off that key (src/house-key.mjs). A settlement that would
  // leave the house split, or rewrite stamps already counted today, refuses
  // before the store holds anything; the tick's pass holds a TODAY for its
  // next tick (deploy/settle-pass.mjs § TRANSIENT).
  const residents = [...new Set([...(mint ? mint.residents : registry.households[slug]?.residents ?? []), h])];
  const keyed = planHouseKey(clone, [{ handle: h, slug, residents }], {
    date, registry: registryWith(registry, slug, residents, mint ? { accounts: [{ login: ghLogin, id: ghId }] } : {}),
  });
  if (keyed?.refusal) throw houseKeyBounce(keyed.refusal, keyed.detail);

  // ONE COMMIT: the two printed registers and the ledger's key lines, the
  // join-bind shape. The drain collects instead of committing on its own.
  if (mint) await mintHousehold(mint);
  const { drain, paths } = collectingDrain({ clone, env });
  const joined = await joinHousehold({
    slug, handle: h, coSign, pinnedOn: date, env, drain,
    ...(adopt ? { adopt } : {}),
  });
  const ledger = appendHouseKey(clone, keyed?.signed);
  const commit = landOrRefuse(() => penCommit(clone, [...paths, ...(ledger ? [ledger] : [])],
    `address: ${h} settled · bound to ${slug} at the merge of #${pr} (via postmark-office, settle-join)`));
  if (commit?.error) return commit;
  const name = founded ?? registry.households[slug]?.name ?? slug;
  return {
    settled: true,
    handle: h,
    road,
    pin: { handle: h, login: ghLogin, gh_id: ghId, pinned: date },
    house: { slug, name },
    pr,
    commit,
    registry: joined.registry,
    note: `${h} is bound to @${ghLogin} (id ${ghId}) and is a resident of ${name}; both files are re-rendered from the record`,
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
  const found = await findJoin(pen, handle);
  return run({ ...found, handle }, { clone, env });
}
