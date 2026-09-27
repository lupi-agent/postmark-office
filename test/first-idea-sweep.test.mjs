// first-idea-sweep.test.mjs — the crossing's first-idea writer, held to the
// quest's terms.   node --test test/first-idea-sweep.test.mjs
//
// THE LAW these quote (first-idea-sweep.mjs header + the town rule's grammar
// comment): 5 stamps, once per household, receipt = the household's first
// published idea mark; idempotent BY LEDGER; the writer holds the window; one
// authority for town law (the clone's own engine, or a named refusal).
//
// The engine under test is the TOWN TRAIN's own stamp-mint (the rule's first
// home), via STAMP_ENGINE_DIR — real law, no fakes. The engine-predates
// falsifier points at a pre-rule engine and must be refused BY NAME.

import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { NO_TOWN, townClone } from "./fixture-paths.mjs";

// The town's own stamp engine — real law, no fake. It was pinned to
// `G:/Postmark/worktrees/town-w36/tools`, a week-36 worktree on one operator's
// disk: a calendar-pinned path that decayed the moment that worktree went, and
// named a machine nobody else has.
const TOWN = townClone();
const TRAIN_ENGINE = TOWN && join(TOWN, "tools");
const SKIP = !TOWN && NO_TOWN;

// The PRE-RULE engine, which is a different artifact from the current one and
// no live checkout provides — so it is named by env var and by nothing else.
// Its one test already skips when it is absent; that skip is the whole
// mechanism, and a hardcoded path to a retired directory added nothing to it.
const OLD_ENGINE = process.env.OLD_STAMP_ENGINE_DIR ?? null;

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PUB = publicKey.export({ type: "spki", format: "pem" });
const PRIV = privateKey.export({ type: "pkcs8", format: "pem" });
const penDir = mkdtempSync(join(tmpdir(), "pm-fisweep-pen-"));
const KEY = join(penDir, "stamp-key.pem");
writeFileSync(KEY, PRIV);
process.env.STAMP_KEY = KEY;
if (TRAIN_ENGINE) process.env.STAMP_ENGINE_DIR = TRAIN_ENGINE;

const { planFirstIdeaSweep, writeFirstIdeaSweep, FIRST_IDEA_WINDOW_END } = await import("../src/first-idea-sweep.mjs");

// A founded town clone: two households, mail, a settled ledger (the train
// engine's own --append founds it, so the tail is real law, not a fixture's).
function foundedClone() {
  const clone = mkdtempSync(join(tmpdir(), "pm-fisweep-town-"));
  mkdirSync(join(clone, "tools"), { recursive: true });
  mkdirSync(join(clone, "WHITE_PAGES"), { recursive: true });
  writeFileSync(join(clone, "tools", "github-ids.json"), JSON.stringify({ alice: 1, bob: 2 }));
  for (const [handle, login] of [["alice", "alogin"], ["bob", "blogin"]]) {
    mkdirSync(join(clone, "WHITE_PAGES", handle), { recursive: true });
    writeFileSync(join(clone, "WHITE_PAGES", handle, "ADDRESS.md"), `---\nhandle: ${handle}\ngithub: ${login}\n---\n`);
  }
  writeFileSync(join(clone, "WHITE_PAGES", "mail-ledger.md"),
    `# ledger\n\n- 2026-06-12 · seed-1 · alice → bob · thread: new\n- 2026-06-13 · seed-2 · bob → alice · thread: new\n`);
  writeFileSync(join(clone, "tools", "stamp-pubkey.pem"), PUB);
  execFileSync(process.execPath, [join(TRAIN_ENGINE, "stamp-mint.mjs"), "--append", "--key", KEY, "--repo", clone], { encoding: "utf8" });
  return clone;
}

const idea = (by, slug, date = "2026-08-30") => ({ id: `${by}/${slug}`, by, body: "a thought", date });

async function verifyGreen(clone) {
  const { verifyStampLedger } = await import(pathToFileURL(join(TRAIN_ENGINE, "stamp-verify.mjs")));
  return verifyStampLedger(clone, { pubkeyPem: PUB });
}

test("HAPPY: two households' first ideas mint two signed lines, and the town's own verifier stays green", { skip: SKIP }, async () => {
  const clone = foundedClone();
  const plan = planFirstIdeaSweep(clone, { date: "2026-08-30", ideas: [idea("alice", "a-town-calendar"), idea("bob", "a-harbor-bell")] });
  assert.equal(plan.mints.length, 2, JSON.stringify(plan));
  const touched = writeFirstIdeaSweep(clone, plan);
  assert.deepEqual(touched, ["WHITE_PAGES/stamp-ledger.md"]);
  const ledger = readFileSync(join(clone, "WHITE_PAGES", "stamp-ledger.md"), "utf8");
  assert.match(ledger, /MINT → alice · 5 · for: first-idea:alice\/a-town-calendar · by: the-town · sig: /);
  assert.match(ledger, /MINT → bob · 5 · for: first-idea:bob\/a-harbor-bell · by: the-town · sig: /);
  const v = await verifyGreen(clone);
  assert.equal(v.ok, true, v.problems?.join("\n"));
  rmSync(clone, { recursive: true, force: true });
});

test("IDEMPOTENT BY LEDGER: the next crossing re-reads the record and plans nothing — a re-run costs nothing", { skip: SKIP }, async () => {
  const clone = foundedClone();
  const ideas = [idea("alice", "a-town-calendar")];
  writeFirstIdeaSweep(clone, planFirstIdeaSweep(clone, { date: "2026-08-30", ideas }));
  const again = planFirstIdeaSweep(clone, { date: "2026-08-31", ideas });
  assert.equal(again.mints.length, 0);
  assert.match(again.skipped[0].why, /already paid/);
  const v = await verifyGreen(clone);
  assert.equal(v.ok, true, v.problems?.join("\n"));
  rmSync(clone, { recursive: true, force: true });
});

test("ONE PER HOUSEHOLD inside a single crossing: the second idea skips in-plan, the FIRST (by date) wins the receipt", { skip: SKIP }, () => {
  const clone = foundedClone();
  const plan = planFirstIdeaSweep(clone, {
    date: "2026-08-30",
    ideas: [idea("alice", "the-earlier-thought", "2026-08-29"), idea("alice", "the-later-thought", "2026-08-30")],
  });
  assert.equal(plan.mints.length, 1);
  assert.equal(plan.mints[0].mark, "alice/the-earlier-thought");
  assert.match(plan.skipped[0].why, /already paid/);
  rmSync(clone, { recursive: true, force: true });
});

test("a roomless publisher skips by name — the mint waits for the room, never invents one", { skip: SKIP }, () => {
  const clone = foundedClone();
  const plan = planFirstIdeaSweep(clone, { date: "2026-08-30", ideas: [idea("ghost", "an-unhoused-thought")] });
  assert.equal(plan.mints.length, 0);
  assert.match(plan.skipped[0].why, /no room for ghost/);
  rmSync(clone, { recursive: true, force: true });
});

test("THE WRITER HOLDS THE WINDOW: past the end, the sweep plans nothing and says so", { skip: SKIP }, () => {
  const clone = foundedClone();
  const plan = planFirstIdeaSweep(clone, { date: "2026-10-01", ideas: [idea("alice", "a-late-thought", "2026-10-01")] });
  assert.equal(plan.mints.length, 0);
  assert.match(plan.note, /window closed 2026-09-30/);
  assert.equal(FIRST_IDEA_WINDOW_END, "2026-09-30");
  rmSync(clone, { recursive: true, force: true });
});

test("ENGINE-PREDATES: a clone whose own stamp-mint lacks the rule is refused BY NAME, never law invented locally", { skip: SKIP }, (t) => {
  if (!OLD_ENGINE || !existsSync(join(OLD_ENGINE, "stamp-mint.mjs"))) return t.skip("no pre-rule engine on this machine — set OLD_STAMP_ENGINE_DIR");
  const clone = foundedClone();
  const prev = process.env.STAMP_ENGINE_DIR;
  try {
    process.env.STAMP_ENGINE_DIR = OLD_ENGINE;
    const plan = planFirstIdeaSweep(clone, { date: "2026-08-30", ideas: [idea("alice", "a-town-calendar")] });
    assert.equal(plan.refused, "engine-predates-first-idea");
    assert.equal(plan.mints.length, 0);
  } finally { process.env.STAMP_ENGINE_DIR = prev; }
  rmSync(clone, { recursive: true, force: true });
});
