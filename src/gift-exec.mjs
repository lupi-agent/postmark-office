// gift-exec.mjs — one founder gift, atomically, under the caller's flock.
//
// Invoked by ops.mjs as a subprocess (on the box: wrapped in `flock -w 30
// town.lock`, the same lock the ferry chain holds — a gift can never race a
// crossing). Does the whole critical section in one process: pull the clone,
// catch the ledger up (--append), mint the gift (--gift) through the town's OWN
// stamp-mint CLI (the single mint law — all its paranoia rides free), commit +
// push the sealed ledger with the pen's ceremony, read back the recipient's new
// balance. Prints exactly one JSON line.
//
// Env: TOWN_CLONE, STAMP_KEY (path to the pen's ed25519 pem), TOWN_PUSH=1,
//      BOT_NAME/BOT_EMAIL (penCommit's), TOWN_TZ.
// argv[2]: JSON { handle, amount, slug, by, date }.
//
// Exit 0 with { line, handle, amount, slug, by, date, balance, commit } or
// { error: { code, defect, hint } } (a bounce is an answer); exit 1 only when
// the machinery itself trips.

import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { penCommit, penTransaction, landOrRefuse } from "./write.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLONE = process.env.TOWN_CLONE ?? resolve(HERE, "..", "town-clone");
const KEY_PATH = process.env.STAMP_KEY ?? "/srv/postmark-office/stamp-key.pem";

const answer = (obj) => { console.log(JSON.stringify(obj)); process.exit(0); };
const refusal = (code, defect, hint) => ({ error: { code, defect, hint } });
const err = (code, defect, hint) => answer(refusal(code, defect, hint));

// Map a stamp-mint FATAL (stderr) to a bounce code + a clean, warm hint. The CLI
// is the enforcer; this only translates its refusals into the door's vocabulary.
function classifyFatal(stderr) {
  const s = String(stderr);
  if (/no WHITE_PAGES room/.test(s)) return { code: 422, defect: "no such resident", hint: "a gift needs a resident to receive it — pick a handle that has a page in town" };
  if (/is a meep at/.test(s)) return { code: 422, defect: "meeps stay outside the currency", hint: "that handle is a town office / meep — gifts go to residents" };
  if (/--slug must be kebab/.test(s)) return { code: 422, defect: "slug must be kebab-case", hint: "lowercase letters, digits, and single hyphens" };
  if (/--amount must be/.test(s)) return { code: 422, defect: "amount must be a whole number ≥ 1", hint: "" };
  if (/ledger is behind the mail/.test(s)) return { code: 409, defect: "the ledger is catching up", hint: "the town is mid-crossing — try again in a moment" };
  if (/precedes the ledger tail/.test(s)) return { code: 409, defect: "the ledger moved ahead of the clock", hint: "try again in a moment" };
  return { code: 500, defect: "the mint refused", hint: (s.split("\n").find(Boolean) ?? "unknown").slice(0, 200) };
}

async function main() {
  const { handle, amount, slug, by, date } = JSON.parse(process.argv[2] ?? "{}");
  if (!existsSync(KEY_PATH))
    return err(409, "not-yet-open", "the office has no pen key configured for the stamp-ledger");
  const mint = join(CLONE, "tools", "stamp-mint.mjs");
  if (!existsSync(mint))
    return err(409, "not-yet-open", "the office has no town clone with the mint engine");

  // WHOLE OR NOTHING (POS-296): a refused gift leaves no catch-up rows and no
  // gift line behind, and a push that cannot land leaves no commit. A gift
  // carries the giver's request and cannot be re-derived, so a refused one is
  // gone — which is what the giver was told.
  answer(await penTransaction(CLONE, async () => {
    if (process.env.TOWN_PUSH === "1")
      execFileSync("git", ["-C", CLONE, "pull", "--rebase", "-q"], { encoding: "utf8" });

    // Catch the ledger up so the gift lands on a settled tail (idempotent — the
    // ferry --appends each crossing, so between crossings this is a no-op), then
    // mint the gift. Both are the town's own CLI; nothing here reimplements minting.
    const run = (args) => execFileSync(process.execPath, [mint, ...args, "--key", KEY_PATH, "--repo", CLONE], { encoding: "utf8" });
    try {
      run(["--append"]);
      run(["--gift", handle, "--amount", String(amount), "--slug", slug, "--by", by, "--date", date]);
    } catch (e) {
      const { code, defect, hint } = classifyFatal(e.stderr ?? e.message ?? e);
      return refusal(code, defect, hint);
    }

    // Commit + push the sealed ledger (the pen's ceremony — same push path letters
    // and stakes use). The gift line is the tail; any catch-up mints ride along.
    const commit = landOrRefuse(() => penCommit(CLONE, [join(CLONE, "WHITE_PAGES", "stamp-ledger.md")],
      `gift: ${by} → ${handle} · ${amount} · gift:${slug} (via postmark-office ops desk)`));
    if (commit?.error) return commit;

    // Read back the signed gift line + the recipient's new balance from the town's
    // own fold (one source of truth — never a hand-rolled parse).
    const { parseStampLedger, foldBalances } = await import(pathToFileURL(mint));
    const entries = parseStampLedger(readFileSync(join(CLONE, "WHITE_PAGES", "stamp-ledger.md"), "utf8"));
    const line = entries.at(-1)?.raw ?? "";
    const balance = foldBalances(entries).get(handle) ?? 0;

    return { line, handle, amount, slug, by, date, balance, commit };
  }));
}

main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
