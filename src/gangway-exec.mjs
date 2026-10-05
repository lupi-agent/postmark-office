// gangway-exec.mjs — the town-writing half of the founder's gangway act (POS-353).
//
// Invoked by `gangwayAtOffice` as a subprocess under the town lock (the lane
// src/standing-exec.mjs takes). Pulls the clone, adopts the file's own state,
// appends the row, renders HARBOR/GANGWAY.md in one pen commit. Prints one
// JSON line: the answer or { error: { code, defect, hint } }.
//
// Env: TOWN_CLONE, TOWN_PUSH=1, BOT_NAME/BOT_EMAIL, TOWN_TZ, WORLD2_PG(_URL).
// argv[2]: JSON { act, actorGhId }.

import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { gangwayUnderLock } from "./gangway-door.mjs";
import { penTransaction } from "./write.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLONE = process.env.TOWN_CLONE ?? resolve(HERE, "..", "town-clone");

const answer = (obj) => { console.log(JSON.stringify(obj)); process.exit(0); };

async function main() {
  const { act, actorGhId } = JSON.parse(process.argv[2] ?? "{}");
  if (!existsSync(CLONE))
    return answer({ error: { code: 409, defect: "not-yet-open", hint: "the office has no town clone to render the gangway into" } });
  answer(await penTransaction(CLONE, async () => {
    if (process.env.TOWN_PUSH === "1")
      execFileSync("git", ["-C", CLONE, "pull", "--rebase", "-q"], { encoding: "utf8" });
    try {
      return await gangwayUnderLock({ act, actorGhId, clone: CLONE });
    } catch (e) {
      if (!e?.code) throw e;
      return { error: { code: e.code, defect: e.defect ?? String(e.message), hint: e.hint ?? null } };
    }
  }));
}

main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
