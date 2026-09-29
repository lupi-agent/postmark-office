// fund-exec.mjs — one witnessed pot receipt, atomically, under the caller's flock.
//
// The gift-exec precedent, verb for verb: pull the clone, catch the ledger up
// (--append), record the receipt through the TOWN's OWN epoch-close CLI (the
// single seam law — its receipt-ref uniqueness and its D5 intake gate ride free,
// and they are the enforcers this door's pre-checks only paraphrase), commit +
// push with the pen's ceremony, read back the sealed line. One JSON line out.
//
// Env: TOWN_CLONE, STAMP_KEY (path to the pen's ed25519 pem), TOWN_PUSH=1,
//      BOT_NAME/BOT_EMAIL (penCommit's), TOWN_TZ.
// argv[2]: JSON { pot, usd, from, ref, date, rail?, via? }.
//
// THE RAIL IS A PARAMETER, and it defaults to `usdc` (2026-08-25). It was
// hardcoded while this exec had exactly one caller — the /fund door, which is
// the USDC rail's second step and nothing else's. tools/stripe-watch.mjs is the
// second caller: same ledger row, same town CLI, same flock, a different rail
// word. The alternative was a second exec that also shells epoch-close --receipt,
// which is a second ledger writer, which is the thing the seam's own note calls
// "the one that drifts is the one nobody rereads". `via` is the phrase the
// commit message names the door by, for the same reason.
//
// The rail set is the TOWN's (`stripe|usdc|grant`, KEEPING_RAILS in
// stamp-mint.mjs and `rail: (stripe|usdc|grant)` in the pot-receipt grammar).
// Checked here only so a bad rail is a bounce with a sentence instead of a
// subprocess FATAL — the CLI refuses it regardless, and that is the enforcer.
//
// Exit 0 with { line, pot, usd, from, ref, date, commit } or
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

// Translate the town CLI's FATALs into the door's vocabulary. The CLI is the
// enforcer; this only gives the patron a sentence instead of a stack.
function classifyFatal(stderr) {
  const s = String(stderr);
  if (/already recorded/.test(s))
    return { code: 409, defect: "this transaction is already recorded", hint: "one dollar, one mint chance — a payment is witnessed exactly once, when it crosses the seam" };
  if (/past pot .* posted target|fully funded for this epoch/.test(s))
    return { code: 409, defect: "that would take the pot past its posted need", hint: (s.split("\n").find((l) => /FATAL/.test(l)) ?? s).replace(/^FATAL:\s*/, "").slice(0, 240) };
  if (/no pot file/.test(s))
    return { code: 404, defect: "no such pot", hint: "the town posts its needs on the board" };
  if (/ledger is behind the mail/.test(s))
    return { code: 409, defect: "the ledger is catching up", hint: "the town is mid-crossing — try again in a moment" };
  if (/precedes the ledger tail/.test(s))
    return { code: 409, defect: "the ledger moved ahead of the clock", hint: "try again in a moment" };
  return { code: 500, defect: "the receipt refused", hint: (s.split("\n").find(Boolean) ?? "unknown").slice(0, 200) };
}

// The town's own rail set (stamp-mint.mjs KEEPING_RAILS / the pot-receipt
// grammar's `rail: (stripe|usdc|grant)`). One word per rail, and no fourth.
const RAILS = ["stripe", "usdc", "grant"];

async function main() {
  const { pot, usd, from, ref, date, rail = "usdc", via = "the /fund door" } = JSON.parse(process.argv[2] ?? "{}");
  if (!RAILS.includes(rail))
    return err(422, `"${rail}" is not a rail`, `a pot receipt rides one of ${RAILS.join(", ")} — the town's own grammar has no fourth`);
  if (!existsSync(KEY_PATH))
    return err(409, "not-yet-open", "the office has no pen key configured for the stamp-ledger");
  const mint = join(CLONE, "tools", "stamp-mint.mjs");
  const close = join(CLONE, "tools", "epoch-close.mjs");
  if (!existsSync(mint) || !existsSync(close))
    return err(409, "not-yet-open", "the office has no town clone with the funding seam");

  // WHOLE OR NOTHING (POS-296): a refused receipt leaves no catch-up rows and
  // no receipt line behind, and a push that cannot land leaves no commit. A
  // receipt carries the payer's request data and cannot be re-derived, so a
  // refused one is gone — which is what the payer was told.
  answer(await penTransaction(CLONE, async () => {
    if (process.env.TOWN_PUSH === "1")
      execFileSync("git", ["-C", CLONE, "pull", "--rebase", "-q"], { encoding: "utf8" });

    try {
      // catch the ledger up so the receipt lands on a settled tail, then witness
      execFileSync(process.execPath, [mint, "--append", "--key", KEY_PATH, "--repo", CLONE], { encoding: "utf8" });
      execFileSync(process.execPath, [
        close, "--receipt",
        "--pot", String(pot), "--rail", String(rail), "--usd", String(usd),
        "--from", String(from), "--ref", String(ref), "--date", String(date),
        "--key", KEY_PATH, "--repo", CLONE,
      ], { encoding: "utf8" });
    } catch (e) {
      const { code, defect, hint } = classifyFatal(e.stderr ?? e.message ?? e);
      return refusal(code, defect, hint);
    }

    const commit = landOrRefuse(() => penCommit(CLONE, [
      join(CLONE, "WHITE_PAGES", "stamp-ledger.md"),
      join(CLONE, "WHITE_PAGES", `pot-${pot}.json`),
    ], `fund: $${usd} witnessed for ${from} → pot ${pot} (${rail} rail, via ${via})`));
    // A payer reads this, so it says what happened to the MONEY: nothing. The
    // receipt was not kept, and the same transaction verifies once when retried.
    if (commit?.error) return refusal(commit.error.code, commit.error.defect,
      "the office lost its race with other town traffic, so this payment is not witnessed yet and nothing was recorded — your payment itself is untouched; verify the same transaction again and it is recorded once");

    const { parseStampLedger } = await import(pathToFileURL(mint));
    const entries = parseStampLedger(readFileSync(join(CLONE, "WHITE_PAGES", "stamp-ledger.md"), "utf8"));
    const line = entries.at(-1)?.raw ?? "";

    return { line, pot, usd, from, ref, date, rail, commit };
  }));
}

main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
