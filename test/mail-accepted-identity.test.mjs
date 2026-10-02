// Regression for postmark-town/postmark#2678.
//
// A letter's accepted id and outbox path are durable identity. The town-log row
// stores both so the drain does not recompute them from a later wall clock.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { fixtureDb, fixtureKey } from "./fixture.mjs";
import { MAIL_ACT, MAIL_DOOR, replayLetter } from "../src/town-mail.mjs";
import { enqueueLetter } from "../src/write.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";

delete process.env.TOWN_PUSH;

function mailClone() {
  const dir = mkdtempSync(join(tmpdir(), "pm-mail-identity-"));
  for (const h of ["wright", "limen"]) {
    mkdirSync(join(dir, "WHITE_PAGES", h, "outbox"), { recursive: true });
    mkdirSync(join(dir, "WHITE_PAGES", h, "inbox"), { recursive: true });
    writeFileSync(join(dir, "WHITE_PAGES", h, "ADDRESS.md"), `---\nhandle: ${h}\n---\n`);
  }
  writeFileSync(join(dir, "WHITE_PAGES", "mail-ledger.md"), "# the mail ledger\n");
  const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "fixture town");
  return dir;
}

// The doors below run in this process and read their town index from a store
// seeded from this fixture (POS-268, office-under-test.mjs).
const IX = await indexStore(fixtureDb());
const IX_RESTORE = await IX.useInProcess();
test.after(async () => { await IX_RESTORE(); await IX.stop(); });

test("#2678 · drain replay preserves the id, path, and date accepted by the send door", () => {
  const clone = mailClone();
  const db = fixtureDb();
  try {
    const args = {
      from: "wright",
      to: "limen",
      title: "midnight crossing",
      thread: "new",
      body: "Accepted before midnight; drained after it.",
    };
    // Deliberately unlike the wall-clock date of this test. If replay derives
    // identity from NOW, this specimen cannot accidentally pass.
    const acceptedDate = "2001-01-02";
    const acceptedId = `wright-${acceptedDate}-to-limen-midnight-crossing`;
    const acceptedFile = `WHITE_PAGES/wright/outbox/letter-${acceptedDate}-to-limen-midnight-crossing.md`;
    const row = {
      cls: "letter",
      act: MAIL_ACT,
      household: fixtureKey.household,
      handle: "wright",
      ghId: fixtureKey.ghId ?? null,
      ghLogin: fixtureKey.ghLogin ?? null,
      payload: { args, id: acceptedId, file: acceptedFile },
    };

    const out = replayLetter(row, {
      doors: { [MAIL_DOOR]: enqueueLetter },
      key: fixtureKey,
      db,
      clone,
    });

    assert.equal(out.skipped, undefined);
    assert.equal(out.result.letter_id, acceptedId,
      "the drain must return the id the send door already accepted, not one derived from drain time");
    assert.equal(existsSync(join(clone, acceptedFile)), true,
      "the accepted outbox path must be the path that materializes");

    const paper = readFileSync(join(clone, acceptedFile), "utf8");
    assert.match(paper, new RegExp(`^---\\nid: ${acceptedId}\\n`));
    assert.match(paper, new RegExp(`\\ndate: ${acceptedDate}\\n`),
      "frontmatter date is part of the accepted identity too");
  } finally {
    db.close();
    rmSync(clone, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
