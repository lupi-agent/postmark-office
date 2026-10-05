// standing-exec.mjs — the town-writing half of the Registrar's standing act (POS-347).
//
// Invoked by `standingAtOffice` as a subprocess under the town lock (the lane
// src/settle-join-exec.mjs takes), so a standing act never races a crossing, a
// declaration or the keep tick's drain. It pulls the clone, adopts the file's
// own lines, judges the act against the record, appends the row and renders the
// file in one pen commit. Prints one JSON line.
//
// Env: TOWN_CLONE, TOWN_PUSH=1, BOT_NAME/BOT_EMAIL (penCommit's), TOWN_TZ, and
// the record's WORLD2_PG / WORLD2_PG_URL.
// argv[2]: JSON { record, actor } — the act the door judged.
//
// Exit 0 with the answer or { error: { code, defect, hint } } (a refusal is an
// answer); exit 1 only when the machinery itself trips.

import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { standingUnderLock } from "./standing-door.mjs";
import { penTransaction } from "./write.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLONE = process.env.TOWN_CLONE ?? resolve(HERE, "..", "town-clone");

const answer = (obj) => { console.log(JSON.stringify(obj)); process.exit(0); };

async function main() {
  const { record, actor } = JSON.parse(process.argv[2] ?? "{}");
  if (!existsSync(CLONE))
    return answer({ error: { code: 409, defect: "not-yet-open", hint: "the office has no town clone to render the ledger into" } });

  // WHOLE OR NOTHING over the clone (POS-296). The row the act writes is in the
  // store, outside the clone, and stays; the next drain renders it.
  answer(await penTransaction(CLONE, async () => {
    if (process.env.TOWN_PUSH === "1")
      execFileSync("git", ["-C", CLONE, "pull", "--rebase", "-q"], { encoding: "utf8" });
    try {
      return await standingUnderLock({ record, actor, clone: CLONE });
    } catch (e) {
      if (!e?.code) throw e;
      return { error: { code: e.code, defect: e.defect ?? String(e.message), hint: e.hint ?? null } };
    }
  }));
}

main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
