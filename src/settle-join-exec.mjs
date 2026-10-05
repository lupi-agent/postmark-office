// settle-join-exec.mjs — the town-writing half of settle-join (#3231).
//
// Invoked by `settleJoinAtOffice` as a subprocess under the town lock (on the
// box: `flock -w 30 town.lock`, the lane `src/declare-exec.mjs` takes), so a
// settlement never races a crossing or a declaration. It pulls the clone,
// re-checks everything against the record and the fresh clone, and runs the
// ceremony; the settle makes the one pen commit (the printed registers and the
// house's key lines, src/house-key.mjs). Prints one JSON line.
//
// Env: TOWN_CLONE, TOWN_PUSH=1, BOT_NAME/BOT_EMAIL (penCommit's), TOWN_TZ.
// argv[2]: JSON { handle, ghId, ghLogin, pr, road, cardLogin } — the join the door read back.
//
// Exit 0 with the answer or { error: { code, defect, hint } } (a refusal is an
// answer); exit 1 only when the machinery itself trips.

import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { settleUnderLock } from "./settle-join.mjs";
import { penTransaction } from "./write.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLONE = process.env.TOWN_CLONE ?? resolve(HERE, "..", "town-clone");

const answer = (obj) => { console.log(JSON.stringify(obj)); process.exit(0); };

const townDate = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: process.env.TOWN_TZ ?? "America/New_York" }).format(new Date());

async function main() {
  const { handle, ghId, ghLogin, pr, road, cardLogin } = JSON.parse(process.argv[2] ?? "{}");
  if (!existsSync(CLONE))
    return answer({ error: { code: 409, defect: "not-yet-open", hint: "the office has no town clone to settle into" } });

  // WHOLE OR NOTHING (POS-296): a settlement refused after the drain wrote its
  // two files, or whose push cannot land (penCommit's NOT_LANDED, code 503),
  // leaves neither file behind. The pin `joinHousehold` wrote is in the store,
  // outside the clone, and stays; the next registry drain renders it.
  answer(await penTransaction(CLONE, async () => {
    // Freshen first: the ADDRESS the Registrar just merged must be on this clone.
    if (process.env.TOWN_PUSH === "1")
      execFileSync("git", ["-C", CLONE, "pull", "--rebase", "-q"], { encoding: "utf8" });

    try {
      return await settleUnderLock({ handle, ghId, ghLogin, pr, road, cardLogin, clone: CLONE, date: townDate() });
    } catch (e) {
      if (!e?.code) throw e;
      return { error: { code: e.code, defect: e.defect ?? String(e.message), hint: e.hint ?? null } };
    }
  }));
}

main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
