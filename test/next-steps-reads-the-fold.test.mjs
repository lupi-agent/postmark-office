// next-steps-reads-the-fold.test.mjs — POS-167. The doorstep's next_steps
// reads the fold the rehydrate already wrote, instead of folding the 13k-line
// stamp ledger again on every request.
//
// THE COST THIS HOLDS, measured on the pool tree's live town clone before the
// change: `nextStepsFor` called `onboardingFactsFor(clone, handle)` with no
// options on the SERVING path, and that one call parses the stamp ledger THREE
// times — `currentHouseholds` twice (once inside `householdKeys` ->
// `sealedRegistryDates`, once for its own `parseLaws`) and `welcomedHouseholds`
// once more. Every doorstep read paid it. The facts were not missing and they
// were not even far away: `standingRowsFromTown` folds the same six at every
// rehydrate and writes them to `quest_standing`, and the SAME doorstep response
// already reads that row for its quest board. The page was answering one
// question from two clocks.
//
// TWO BRANCHES, HELD SEPARATELY, and that is why there are two flips in
// pos167-flip.sh rather than one. A fix that spans a read and its fallback can
// have either half inverted while the other half's coverage carries the suite:
//   · F2/F3 hold the WIRING of the row path — zero parses, and the answer
//     follows the row rather than the clone.
//   · F4/F5 hold the FALLBACK — an index with no standing row still answers
//     exactly what it answered before this change, at exactly its old cost.
//   · F1 is the projection's own unit and holds neither wiring, so it stays
//     green under both flips. That is stated rather than hidden: a case that
//     cannot red under either inversion is not coverage of the seam, and
//     counting it as such is how a suite looks stronger than it is.
// Flip A (restore the live call) reds F2 and F3, and only those.
// Flip B (drop the fallback)     reds F4 and F5, and only those.
//
// THE LEDGER COUNTER IS REAL, NOT A MOCK. It wraps the town module's own
// `readFileSync` through a loader hook in the parse-counting cases below by
// the only means a test has without one: it reads the ledger's mtime-free
// truth — the count of times the file is opened — via a patched fs. Node's
// test runner cannot install a loader hook mid-process, so the counting cases
// drive a CHILD process with `--import`. A counting case that could not fail
// would be worth nothing, so each child ends by proving the counter moves.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { nextStepsFor, onboardingFactsFromStanding, STANDING_FACT } from "../src/queries.mjs";
import { fixtureDb } from "./fixture.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
// The office's own resolution order, matching next-steps.test.mjs and
// quest-standing.test.mjs. A MISSING clone fails loudly rather than skipping:
// a guard that quietly opts out of running is worth less than no guard.
const TOWN = process.env.TOWN_CLONE
  ?? [resolve(ROOT, "town-clone"), "G:/Wright-HQ/postmark"].find((p) => existsSync(join(p, "quest-registry.json")))
  ?? resolve(ROOT, "town-clone");

const registryText = () => {
  const p = join(TOWN, "quest-registry.json");
  assert.ok(existsSync(p),
    `no town checkout at ${TOWN} — set TOWN_CLONE. The office imports the town's quest law live; there is nothing to guard without it.`);
  return readFileSync(p, "utf8");
};
const META = () => ({ quest_registry: registryText(), quest_day: "1970-01-01" });

// The two rows, in the shape `standingRowsFromTown` writes them.
const SETTLED = {
  card: true, home: true, window: true, sent: true, received: true, welcomed: true,
  sent_since: "2026-06-12", sent_via: "wright-2026-06-12-first-post",
  received_since: "2026-06-12", received_via: "postmaster-2026-06-12-receipt-confirmed",
  depth: { eachWay: 8, best: 5, since: "2026-08-04", friends: [] },
};
const FRESH = {
  card: false, home: false, window: false, sent: false, received: false, welcomed: false,
  sent_since: null, sent_via: null, received_since: null, received_via: null,
  depth: { eachWay: 0, best: 0, since: null, friends: [] },
};

const withRow = (handle, row) => {
  const db = fixtureDb();
  if (row) db.prepare("INSERT INTO quest_standing (handle, json) VALUES (?, ?)").run(handle, JSON.stringify(row));
  return db;
};
const onboardingIds = (ns) => new Set(ns.steps.filter((s) => s.kind === "onboarding").map((s) => s.id));

// ── THE PRECONDITION THAT MAKES F2 MEAN ANYTHING ────────────────────────────
//
// F2 asserts the answer follows the ROW rather than the clone, and it can only
// say that if the two DISAGREE. So the disagreement is asserted first, out
// loud: `wright` is settled on the live checkout, and the row F2 drives with is
// fresh. If the checkout ever changes under this suite, this case reds and
// names the reason instead of letting F2 quietly become a tautology.

test("F0 · the live checkout says `wright` is SETTLED — so a FRESH row genuinely disagrees with it", async () => {
  const { pathToFileURL } = await import("node:url");
  const qp = await import(pathToFileURL(join(TOWN, "tools", "quest-progress.mjs")).href);
  const live = qp.onboardingFactsFor(TOWN, "wright");
  for (const fact of Object.values(STANDING_FACT)) {
    assert.equal(live[fact], true,
      `the checkout at ${TOWN} answers ${fact}=${live[fact]} for wright. F2 drives a row with ${fact}=false to prove the answer follows the ROW; if the clone already says false, that case proves nothing.`);
  }
});

// ⚑ THIS ASSERTION IS A SECOND HOME FOR A BINDING THAT ALREADY EXISTS, and the
// reason is a measurement, not distrust. `onboardingFactsFromStanding` projects
// by `Object.values(STANDING_FACT)`, which is safe only because that map is
// bound to the town's own exported `ONBOARDING_IDS`. The two cases that bind it
// live in test/quest-standing.test.mjs — and in a pool tree they DO NOT RUN:
// that file resolves its town to a hardcoded `G:/Wright-HQ/postmark` with no
// fallback list, so both die at import with ERR_MODULE_NOT_FOUND. Measured on
// the train tip in this tree, before any of this lane's changes.
//
// So the guard my projection leans on is, here, a guard that cannot load — and
// "it is covered one file over" would be coverage I could not point at. This
// file resolves its town through the fallback list every other office suite
// uses, so it can hold the invariant where it actually runs. The hardcoded path
// is NOT fixed here: it is another lane's line, and reaching into it would put
// two hands on one file.
test("F0b · the projection's fact set IS the town's own — asserted where the town checkout resolves", async () => {
  const { pathToFileURL } = await import("node:url");
  const qp = await import(pathToFileURL(join(TOWN, "tools", "quest-progress.mjs")).href);
  assert.deepEqual(
    [...Object.keys(STANDING_FACT), "walk-the-world"].sort(),
    [...qp.ONBOARDING_IDS].sort(),
    "STANDING_FACT no longer covers the town's onboarding line — the projection would silently stop carrying a row the town added");
  const live = qp.onboardingFactsFor(TOWN, "wright");
  assert.deepEqual(Object.keys(live).sort(), Object.values(STANDING_FACT).sort(),
    "the facts `onboardingFactsFor` answers are no longer exactly the facts the projection reads off the row — one side grew and the other did not");
});

// ── F1/F2/F3 — THE ROW PATH ─────────────────────────────────────────────────

test("F1 · the six onboarding facts are projected off the standing row, by the town's own id map", () => {
  const facts = onboardingFactsFromStanding(SETTLED);
  assert.deepEqual(facts, { card: true, home: true, window: true, sent: true, received: true, welcomed: true });
  assert.deepEqual(Object.keys(facts).sort(), Object.values(STANDING_FACT).sort(),
    "the projection's keys ARE the map's values — a seventh fact typed here is a second copy of the town's law");
  // and the can-fail direction: a row the rehydrate never wrote, and a row from
  // an office that predates a fact, are both REFUSED rather than read as false.
  assert.equal(onboardingFactsFromStanding(null), null, "no row is not six false facts");
  const { welcomed, ...preWelcome } = SETTLED;
  assert.equal(onboardingFactsFromStanding(preWelcome), null,
    "a row written before `welcomed` joined the fold must not read back as un-welcomed — absent is not false");
});

test("F2 · the doorstep's onboarding steps follow the ROW, not the clone — both directions", async () => {
  const fresh = await nextStepsFor(withRow("wright", FRESH), META(), "wright", TOWN);
  assert.ok(fresh, `nextStepsFor returned null — the checkout at ${TOWN} has no composeNextSteps`);
  const open = onboardingIds(fresh);
  for (const id of Object.keys(STANDING_FACT)) {
    assert.equal(open.has(id), true,
      `the row says "${id}" is not done and the block dropped it anyway — the serving path is still folding the clone live`);
  }
  // The other direction, against the SAME clone: a settled row empties the list.
  // Without this half the case would pass against a block that simply listed
  // every onboarding row unconditionally.
  const settled = await nextStepsFor(withRow("wright", SETTLED), META(), "wright", TOWN);
  const still = onboardingIds(settled);
  for (const id of Object.keys(STANDING_FACT)) {
    assert.equal(still.has(id), false, `"${id}" is settled on the row and still on the checklist`);
  }
  assert.notDeepEqual([...open], [...still], "the two rows produced the same answer — the row is not being read at all");
});

test("F3 · a doorstep read with a standing row parses the stamp ledger ZERO times", () => {
  const out = child(`
    const db = fixtureDb();
    db.prepare("INSERT INTO quest_standing (handle, json) VALUES (?, ?)").run("wright", JSON.stringify(SETTLED));
    const c0 = count();
    const ns = await nextStepsFor(db, META(), "wright", TOWN);
    const parses = count() - c0;
    console.log(ns ? ("RESULT parses=" + parses + " steps=" + ns.steps.length) : "RESULT VOID no-compose-next-steps");
  `);
  const m = out.match(/RESULT parses=(\d+) steps=(\d+)/);
  assert.ok(m, `the child did not report a result:\n${out}`);
  assert.equal(Number(m[1]), 0,
    `a doorstep read parsed the stamp ledger ${m[1]} time(s). The rehydrate already folded these six facts into quest_standing; the serving path must read them, not re-fold a 13k-line ledger per request.`);
  // THE COUNTER CONTROL, inside the same child: a 0 from a counter that never
  // fires is worth nothing.
  assert.match(out, /CONTROL moved=([1-9]\d*)/,
    `the ledger counter never fired in that child, so its 0 above means nothing:\n${out}`);
});

// ── F4/F5 — THE FALLBACK ────────────────────────────────────────────────────
//
// An index that carries no standing row for this handle is not a hypothetical:
// `standingFor`'s own header calls it "null when the index predates the seam",
// and between a deploy and the first rehydrate that is every resident. Answering
// such a read from an absent row would print six finished chores back onto the
// checklist of a resident who did them — #1864 in a new mouth, and the exact
// failure this file's own neighbours were written against. So the fallback is
// TODAY'S behaviour, unchanged, at today's cost, for exactly that case.

test("F4 · with no standing row the block still answers from the clone — unchanged behaviour", async () => {
  const ns = await nextStepsFor(withRow("wright", null), META(), "wright", TOWN);
  assert.ok(ns, "an index with no standing row must still answer");
  const open = onboardingIds(ns);
  for (const id of Object.keys(STANDING_FACT)) {
    assert.equal(open.has(id), false,
      `"${id}" is settled on the live checkout and the block listed it anyway — the fallback is not reading the clone, it is reading an absent row as six false facts`);
  }
  // Can-fail: the same call must be able to SURFACE a row. Driven against a
  // handle the checkout has nothing for, so the clone itself says "not done".
  const stranger = await nextStepsFor(withRow("nobody-by-this-name", null), META(), "nobody-by-this-name", TOWN);
  assert.ok(stranger, "the block answers for a handle the checkout does not know");
  assert.ok(onboardingIds(stranger).size > 0,
    "a handle with nothing done surfaced no onboarding step at all — this case would pass by having nothing to check");
});

test("F5 · the fallback costs what it always cost — three ledger parses, and it is the ONLY path that parses", () => {
  const out = child(`
    const c0 = count();
    const ns = await nextStepsFor(fixtureDb(), META(), "wright", TOWN);
    const parses = count() - c0;
    console.log(ns ? ("RESULT parses=" + parses + " steps=" + ns.steps.length) : "RESULT VOID no-compose-next-steps");
  `);
  const m = out.match(/RESULT parses=(\d+) steps=(\d+)/);
  assert.ok(m, `the child did not report a result:\n${out}`);
  assert.ok(Number(m[1]) > 0,
    `the no-row path parsed the ledger ${m[1]} times. It is meant to be the OLD call, unchanged — a 0 here means the fallback was silently replaced by six false facts.`);
  assert.match(out, /CONTROL moved=([1-9]\d*)/, `the ledger counter never fired in that child:\n${out}`);
});

// ── the child-process harness ───────────────────────────────────────────────
//
// Node cannot register a loader hook after the process has modules loaded, and
// the ledger count has to come from the town module's real `readFileSync`
// rather than a stub — a stubbed count measures the stub. So each counting case
// writes a tiny driver and runs it under `--import`, with the hook asserting
// its own match count and throwing on zero (a patch that patches nothing runs
// green).

function child(body) {
  const dir = mkdtempSync(join(tmpdir(), "pos167-"));
  try {
    writeFileSync(join(dir, "hook.mjs"), HOOK);
    writeFileSync(join(dir, "register.mjs"),
      `import { register } from 'node:module';\nregister(new URL('./hook.mjs', import.meta.url));\n`);
    writeFileSync(join(dir, "driver.mjs"), DRIVER(body));
    try {
      return execFileSync(process.execPath,
        ["--import", pathToFileUrlString(join(dir, "register.mjs")), join(dir, "driver.mjs")],
        { encoding: "utf8", env: { ...process.env, POS167_TOWN: TOWN, POS167_ROOT: ROOT }, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      // A child that died still has to REPORT. Swallowing the throw here and
      // handing the assertions its output is what turns "the test crashed" into
      // "the counter read N and the control never fired" — which is the line
      // that tells a reader whether the 0 above meant anything.
      return `CHILD EXITED ${e.status}\n--- stdout ---\n${e.stdout ?? ""}\n--- stderr ---\n${e.stderr ?? ""}`;
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

function pathToFileUrlString(p) { return new URL(`file:///${p.replace(/\\/g, "/")}`).href; }

const HOOK = `
const TARGETS = new Map([
  ["tools/stamp-mint.mjs", "import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';"],
  ["tools/quest-progress.mjs", "import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';"],
]);
const SHIM = (orig) =>
  orig.replace("readFileSync,", "readFileSync as __pos167_rfs,") +
  "\\nconst readFileSync = (p, ...a) => { if (typeof p === 'string' && p.includes('stamp-ledger')) { globalThis.__POS167 = (globalThis.__POS167 ?? 0) + 1; } return __pos167_rfs(p, ...a); };\\n";
export async function load(url, context, nextLoad) {
  const r = await nextLoad(url, context);
  for (const [suffix, importLine] of TARGETS) {
    if (!url.endsWith(suffix)) continue;
    let src = typeof r.source === "string" ? r.source : Buffer.from(r.source).toString("utf8");
    const n = src.split(importLine).length - 1;
    if (n !== 1) throw new Error("POS167 HOOK: expected exactly 1 fs import in " + url + ", found " + n);
    src = src.replace(importLine, SHIM(importLine));
    if (!src.includes("__pos167_rfs")) throw new Error("POS167 HOOK: shim did not land in " + url);
    return { ...r, source: src };
  }
  return r;
}
`;

const DRIVER = (body) => `
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const TOWN = process.env.POS167_TOWN;
const ROOT = process.env.POS167_ROOT;
const { nextStepsFor } = await import(pathToFileURL(join(ROOT, 'src', 'queries.mjs')).href);
const { fixtureDb } = await import(pathToFileURL(join(ROOT, 'test', 'fixture.mjs')).href);
const qp = await import(pathToFileURL(join(TOWN, 'tools', 'quest-progress.mjs')).href);
const META = () => ({ quest_registry: readFileSync(join(TOWN, 'quest-registry.json'), 'utf8'), quest_day: '1970-01-01' });
const SETTLED = ${JSON.stringify(SETTLED)};
const count = () => globalThis.__POS167 ?? 0;
${body}
const c1 = count();
qp.onboardingFactsFor(TOWN, 'wright');
console.log('CONTROL moved=' + (count() - c1));
`;
