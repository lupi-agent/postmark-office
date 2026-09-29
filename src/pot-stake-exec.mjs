// pot-stake-exec.mjs — one keeping stake, atomically, under the caller's flock.
//
// The sibling of stake-exec.mjs, and deliberately its twin: same subprocess
// shape, same flock, same pen, same one-JSON-line contract. A keeping stake is
// the ballot stake pointed at a funding pot, and the ledger's grammar has
// anticipated it since the seam landed — `pot/` is "reserved out of the ballot
// topic space like `world-mark/`" (stamp-mint.mjs's own words). What has been
// missing is a door.
//
// ONE PEN, ONE LAW, NEVER A SECOND WRITER. Every line this file appends is
// built by the TOWN's own builder (potStakeLine) and signed by the TOWN's own
// appendSigned, imported live from the checkout — the same discipline
// stake-exec keeps with clipApply. This process computes exactly one thing the
// town has no function for yet: the clip against liquid balance.
//
// WHY THERE IS NO HEADROOM CHECK, unlike a ballot stake: a ballot caps stamps
// per household per candidate, and a pot does not. D5's cap is on DOLLARS at
// intake ("intake refuses dollars past a pot's posted target … except pots
// explicitly marked uncapped") — a limit on the money rail, not the stamp one.
// Inventing a stamp cap here would be this door writing law.
//
// Env: TOWN_CLONE, STAMP_KEY, TOWN_PUSH, BOT_NAME/BOT_EMAIL, TOWN_TZ.
// argv[2]: JSON { handle, pot, n, via, date }.

import { readFileSync, existsSync, realpathSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { penCommit, penTransaction, landOrRefuse } from "./write.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLONE = process.env.TOWN_CLONE ?? resolve(HERE, "..", "town-clone");
const KEY_PATH = process.env.STAMP_KEY ?? "/srv/postmark-office/stamp-key.pem";

const err = (code, defect, hint) => ({ error: { code, defect, hint } });

export function clipPotStake({ state, pots, handle, pot, n, date }) {
  if (!handle || !pot || !date) return err(422, "incomplete stake", "required: handle, pot, n");
  n = Number(n);
  if (!Number.isInteger(n) || n < 1) return err(422, "stamps must be a whole number of at least 1", "stakes move whole stamps");

  const row = pots.find((p) => p.id === pot);
  if (!row) {
    return err(404, `no pot "${pot}"`,
      `the town posts: ${pots.map((p) => p.id).join(", ") || "no pots at all right now"}`);
  }
  if (row.data.status !== "open") {
    return err(409, `pot "${pot}" is ${row.data.status}, not open`,
      "opening a pot is the founder's word, never a merge — a pot that is not open takes neither dollars nor stakes");
  }
  // stamps-v2: meeps neither mint nor stake. The same refusal clipApply gives,
  // in the same words, because it is the same law.
  if (state.lawAt(date).meeps.has(handle)) {
    return err(403, `meep accounts cannot stake (${handle})`, "stamps-v2 law: meeps neither mint nor stake");
  }

  const balance = state.balances.get(handle) ?? 0;
  const applied = Math.min(n, balance);
  const result = { requested: n, applied, clipped: applied < n, balance_before: balance, pot, handle };
  if (applied <= 0) {
    result.reason = "your balance has no stamps free to stake";
    return result;
  }
  result.balance_after = balance - applied;
  return result;
}

/**
 * THE CLIP'S TWO INPUTS, BUILT ONCE (POS-83).
 *
 * `main` below and the pot door's PREVIEW (`household-stamps.mjs
 * § potStakePreview`) both need the ballot state and the pot list to reach
 * `clipPotStake`, and a preview that assembled its own pair would be a second
 * answer to "what is this pot and what does this resident hold" — the drift
 * class this whole file is written against. So the pair is built here, taking
 * the clone as a PARAMETER (main passes its module-level one), and both callers
 * ask for it.
 */
export async function potStakeInputs(clone) {
  const { ballotState } = await import(pathToFileURL(join(clone, "tools", "ballot.mjs")));
  const { readPots } = await import(pathToFileURL(join(HERE, "funding.mjs")));
  return { state: ballotState(clone), pots: readPots(clone).pots };
}

async function main() {
  const payload = JSON.parse(process.argv[2] ?? "{}");
  if (!existsSync(KEY_PATH)) {
    console.log(JSON.stringify(err(409, "not-yet-open", "the office has no pen key configured for the stamp-ledger")));
    return;
  }
  const keyPem = readFileSync(KEY_PATH, "utf8");
  const { potStakeLine, appendSigned } = await import(pathToFileURL(join(CLONE, "tools", "stamp-mint.mjs")));

  // WHOLE OR NOTHING (POS-296), stake-exec's shape: a keeping stake the pen
  // cannot land leaves no line and no commit behind.
  const result = await penTransaction(CLONE, async () => {
    if (process.env.TOWN_PUSH === "1")
      execFileSync("git", ["-C", CLONE, "pull", "--rebase", "-q"], { encoding: "utf8" });

    const { state, pots } = await potStakeInputs(CLONE);
    const result = clipPotStake({ state, pots, ...payload });
    if (result.error) return result;

    if (result.applied > 0) {
      appendSigned(CLONE, [potStakeLine({
        date: payload.date, handle: payload.handle, pot: payload.pot, n: result.applied, via: payload.via ?? "api",
      })], keyPem);
      const commit = landOrRefuse(() => penCommit(CLONE, [join(CLONE, "WHITE_PAGES", "stamp-ledger.md")],
        `keeping stake: ${payload.handle} -> pot/${payload.pot} · ${result.applied} (via ${payload.via ?? "api"})`));
      if (commit?.error) return commit;
      result.commit = commit;
    }
    return result;
  });
  console.log(JSON.stringify(result));
}

// ── entry guard ──────────────────────────────────────────────────────────────
// The junction lesson (2026-09-05, HQ memory `junctions-defeat-main-guards`):
// `pathToFileURL(process.argv[1]).href === import.meta.url` is FALSE when the
// entry path reaches this file through a Windows junction — the ESM loader
// realpaths the entry, argv[1] is not — so the tool exits 0 having done nothing.
// Compare real paths (world2/tools/await-clearing.mjs's idiom); the URL compare is
// only the fallback for an argv[1] that cannot be realpath'd. The office's
// test/cli-guard.test.mjs imports this file and spawns it through a junction.
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) {
  main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
}
