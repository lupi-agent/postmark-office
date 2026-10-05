// stake-exec.mjs — one stake, atomically, under the caller's flock.
//
// Invoked by votes.mjs as a subprocess (on the box: wrapped in
// `flock -w 30 town.lock`, the same lock the ferry chain holds — a stake
// append can never race a crossing). Does the whole critical section in one
// process: pull the clone, run the town's own clip engine, commit + push the
// sealed ledger with the pen's ceremony. Prints exactly one JSON line.
//
// Env: TOWN_CLONE, STAMP_KEY (path to the pen's ed25519 pem), TOWN_PUSH=1,
//      BOT_NAME/BOT_EMAIL (penCommit's), TOWN_TZ.
// argv[2]: JSON { handle, topic, candidate, n, via, date }.
//
// Exit 0 with {applied,...} or {error:{code,defect,hint}} (a bounce is an
// answer); exit 1 only when the machinery itself trips.

import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { penTransaction } from "./write.mjs";
import { landStamped } from "./stamp-lines.mjs"; // POS-341: the ledger's lines are recorded in the store in the commit's transaction

const HERE = dirname(fileURLToPath(import.meta.url));
const CLONE = process.env.TOWN_CLONE ?? resolve(HERE, "..", "town-clone");
const KEY_PATH = process.env.STAMP_KEY ?? "/srv/postmark-office/stamp-key.pem";

async function main() {
  const payload = JSON.parse(process.argv[2] ?? "{}");
  if (!existsSync(KEY_PATH)) {
    console.log(JSON.stringify({ error: { code: 409, defect: "not-yet-open", hint: "the office has no pen key configured for the stamp-ledger" } }));
    return;
  }
  const keyPem = readFileSync(KEY_PATH, "utf8");
  const { clipApply } = await import(pathToFileURL(join(CLONE, "tools", "ballot.mjs")));

  // WHOLE OR NOTHING (POS-296): a stake the pen cannot land leaves no line and
  // no commit behind. It carries the resident's request and cannot be
  // re-derived, so a refused one is gone — which is what they were told.
  const result = await penTransaction(CLONE, async () => {
    if (process.env.TOWN_PUSH === "1")
      execFileSync("git", ["-C", CLONE, "pull", "--rebase", "-q"], { encoding: "utf8" });

    let result;
    try {
      result = clipApply(CLONE, payload, keyPem);
    } catch (e) {
      if (e.code) return { error: { code: e.code, defect: e.defect, hint: e.hint } };
      throw e;
    }

    if (result.applied > 0) {
      const commit = await landStamped(CLONE, [join(CLONE, "WHITE_PAGES", "stamp-ledger.md")],
        `stake: ${payload.handle} -> ${payload.topic}/${payload.candidate} · ${result.applied} (via ${payload.via})`);
      if (commit?.error) return commit;
      result.commit = commit;
    }
    return result;
  });
  console.log(JSON.stringify(result));
}

main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
