// welcome-pass.test.mjs — the office drain that pays the welcome bundle.
//
// THE DEFECT THESE WATCH. The welcome bundle was founder-ruled 2026-09-14 — ✦5
// to every household, once, at its first resident — and three published surfaces
// said the office writes it at a crossing: the town's registry row (`awaits: the
// town's own hand — the office writes the bundle at a crossing`), the grammar
// note above `WELCOME_RE`, and the `--welcome` verb's own header. No such code
// existed. The crossing's mint pass is `stamp-mint.mjs --append`, which appends
// DERIVED mints only; a welcome is an in-place assertion the fold READS and
// never generates. Six households that joined after the 09-14 by-hand pass were
// reading a promise nothing scheduled would ever keep.
//
// Each test below drives the REAL exported function or the REAL town verb
// against a throwaway town — the parse against captured plan text, the mint
// against a synthetic clone carrying the town's own stamp-mint.mjs. Nothing
// here re-implements a town rule, which is the whole design of the pass.

import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { parseWelcomePlan, townDate, mintArgv, main } from "../deploy/welcome-pass.mjs";
import { NO_TOWN, townClone } from "./fixture-paths.mjs";

const TOWN = townClone(); // the same real checkout every office test imports the town's tools from
const SKIP = !TOWN && NO_TOWN;

// ── a throwaway town carrying the town's OWN mint ────────────────────────────
//
// `stamp-mint.mjs` imports nothing local (node:crypto/fs/path/url only), so one
// copied file is a complete, real mint. The pass then runs the town's verbs
// exactly as it does on the box — no stub of the mint anywhere in this file,
// because a stub would be this office asserting its own idea of the welcome law
// back to itself.
function fixtureTown({ pins, deliveries = [] }) {
  const repo = mkdtempSync(join(tmpdir(), "welcome-pass-"));
  mkdirSync(join(repo, "tools"), { recursive: true });
  mkdirSync(join(repo, "WHITE_PAGES"), { recursive: true });
  copyFileSync(join(TOWN, "tools", "stamp-mint.mjs"), join(repo, "tools", "stamp-mint.mjs"));
  writeFileSync(join(repo, "tools", "github-ids.json"), JSON.stringify(pins));
  for (const handle of Object.keys(pins)) {
    mkdirSync(join(repo, "WHITE_PAGES", handle), { recursive: true });
    writeFileSync(join(repo, "WHITE_PAGES", handle, "ADDRESS.md"), `---\nhandle: ${handle}\n---\n`);
  }
  writeFileSync(join(repo, "WHITE_PAGES", "mail-ledger.md"), `# ledger\n\n${deliveries.join("\n")}\n`);

  const { privateKey } = generateKeyPairSync("ed25519");
  const keyFile = join(repo, "stamp-key.pem");
  writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }));
  // Found the ledger: `--welcome` refuses onto an unfounded or unsettled tail,
  // which is exactly why the tick runs the append before the pass.
  execFileSync(process.execPath,
    [join(repo, "tools", "stamp-mint.mjs"), "--append", "--key", keyFile, "--repo", repo],
    { encoding: "utf8" });
  return { repo, keyFile };
}

const D = (date, id, from, to) => `- ${date} · ${id} · ${from} → ${to} · thread: new`;
const ledgerOf = (repo) => readFileSync(join(repo, "WHITE_PAGES", "stamp-ledger.md"), "utf8");
const welcomeRows = (repo) => ledgerOf(repo).split(/\r?\n/).filter((l) => / · for: welcome:/.test(l));

// A real plan, captured verbatim from the live town on 2026-09-17.
const REAL_PLAN = `welcome plan — 118 household(s) in the roll, 112 already welcomed, 6 owed
  (5 stamps each; 30 stamps in total if every owed bundle is written)

OWED — first resident · household · (residents)
  rook-of-all-sorts · gh:256883703 · (rook-of-all-sorts) · pinned 2026-09-14
  fiery-nomi · gh:329054166 · (fiery-nomi, gentle-nomi, midnight-scholar) · pinned 2026-09-15
  emil · hh:emil-and-tempo · (emil) · pinned 2026-09-15
  geoff-of-all-sorts · hh:house-of-all-sorts · (geoff-of-all-sorts) · pinned 2026-09-14
  quibble · hh:house-of-marginalia · (quibble) · pinned 2026-09-15
  caelum-of-the-umbra · hh:umbraliminalis · (caelum-of-the-umbra) · no pin

ALREADY WELCOMED
  gh:103231393 · paid 2026-09-14 → luminari-of-replika
  gh:11590692 · paid 2026-09-14 → athena
`;

// ── the parse, which is a text contract with the town ────────────────────────

test("the real plan parses to the households the town named, and only those", () => {
  const p = parseWelcomePlan(REAL_PLAN);
  assert.equal(p.roll, 118);
  assert.equal(p.welcomed, 112);
  assert.equal(p.owed.length, 6);
  assert.deepEqual(p.owed.map((o) => o.household), [
    "gh:256883703", "gh:329054166", "hh:emil-and-tempo",
    "hh:house-of-all-sorts", "hh:house-of-marginalia", "hh:umbraliminalis",
  ]);
  assert.deepEqual(p.owed.map((o) => o.first), [
    "rook-of-all-sorts", "fiery-nomi", "emil",
    "geoff-of-all-sorts", "quibble", "caelum-of-the-umbra",
  ]);
  assert.deepEqual(p.owed[1].residents, ["fiery-nomi", "gentle-nomi", "midnight-scholar"],
    "the whole house rides into the receipt, so an operator reading the journal can see who was paid for");
  assert.equal(p.owed[5].note, "no pin",
    "an unpinned first resident is a real state the town prints; swallowing it would hide how the tie was broken");
});

test("a plan with nothing owed is a clean empty answer, never a throw", () => {
  const p = parseWelcomePlan("welcome plan — 118 household(s) in the roll, 118 already welcomed, 0 owed\n  (5 stamps each; 0 stamps in total if every owed bundle is written)\n");
  assert.equal(p.owed.length, 0);
  assert.equal(p.welcomed, 118);
});

// ⚑ THE TWO GUARDS THAT MAKE THIS PARSE SAFE TO SCHEDULE. A parser over prose
// fails by finding NOTHING, and finding nothing here reads exactly like "the
// town owes nobody" — a pass that reports success forever while six households
// wait. Both guards turn that silence into a stop.

test("a plan this office cannot read STOPS the pass — it never reads as nothing owed", () => {
  assert.throws(() => parseWelcomePlan("welcome bundles: 6 households are owed one\n  alice · gh:1\n"),
    /did not print a header this office can read/,
    "a town wording change must stop the pass, not quietly empty it");
  assert.throws(() => parseWelcomePlan(""), /did not print a header this office can read/);
});

test("the plan's own count is the bind: rows parsed must equal rows claimed", () => {
  // The header says 6; the OWED block carries 2 this parse can read. A partial
  // read is the dangerous case, because it mints SOME and reports success.
  const short = REAL_PLAN.split("\n").filter((l) => !/^ {2}(emil|geoff|quibble|caelum)/.test(l)).join("\n");
  assert.throws(() => parseWelcomePlan(short),
    /says 6 household\(s\) owed and this office parsed 2/,
    "refusing a set it cannot fully account for is the whole reason the header count is read");
});

test("a row naming something that is not a household key is refused before any mint", () => {
  const bad = REAL_PLAN.replace("gh:256883703", "not-a-key");
  assert.throws(() => parseWelcomePlan(bad), /which is not a household key/);
});

test("an unreadable row inside the owed block stops the pass", () => {
  const bad = REAL_PLAN.replace("  emil · hh:emil-and-tempo · (emil) · pinned 2026-09-15", "  emil owed a bundle");
  assert.throws(() => parseWelcomePlan(bad), /unreadable row in the town's owed list/);
});

// ── the pass against a real mint ─────────────────────────────────────────────

test("every owed household is paid ✦5 once, to its FIRST resident, by the town", { skip: SKIP }, async () => {
  const { repo, keyFile } = fixtureTown({
    // alice and bob share one house; alice is pinned earlier, so the bundle is
    // hers. carol is her own house. The first-resident rule is the TOWN's and is
    // read from its plan — this asserts the office honoured it, never re-derives it.
    pins: { alice: { id: 1, pinned: "2026-06-01" }, bob: { id: 1, pinned: "2026-06-05" }, carol: { id: 2, pinned: "2026-06-02" } },
    deliveries: [D("2026-06-12", "a-1", "alice", "bob"), D("2026-06-13", "c-1", "carol", "alice")],
  });
  const code = await main(["--town", repo, "--key", keyFile, "--date", "2026-09-14"]);
  assert.equal(code, 0);

  const rows = welcomeRows(repo);
  assert.equal(rows.length, 2, `two households, two bundles — got:\n${rows.join("\n")}`);
  assert.ok(rows.some((l) => /- 2026-09-14 · MINT → alice · 5 · for: welcome:gh:1 · by: the-town/.test(l)),
    `alice is gh:1's first resident (pinned 2026-06-01, before bob) and must hold the bundle:\n${rows.join("\n")}`);
  assert.ok(rows.some((l) => /- 2026-09-14 · MINT → carol · 5 · for: welcome:gh:2 · by: the-town/.test(l)));
  assert.ok(!rows.some((l) => / → bob · /.test(l)),
    "bob shares alice's house; a second line for him would be a second bundle for one household");
  rmSync(repo, { recursive: true, force: true });
});

test("a SECOND pass mints nothing more — and the town's own law is what refuses", { skip: SKIP }, async () => {
  const { repo, keyFile } = fixtureTown({
    pins: { alice: { id: 1, pinned: "2026-06-01" } },
    deliveries: [D("2026-06-12", "a-1", "alice", "alice")],
  });
  assert.equal(await main(["--town", repo, "--key", keyFile, "--date", "2026-09-14"]), 0);
  const after = ledgerOf(repo);
  assert.equal(welcomeRows(repo).length, 1);

  // The ordinary second run: the plan no longer names her, so nothing is asked.
  // This is the path the tick takes every crossing, and it must be a clean
  // no-op — NOT the guard, which the next test drives directly.
  assert.equal(await main(["--town", repo, "--key", keyFile, "--date", "2026-09-15"]), 0);
  assert.equal(ledgerOf(repo), after, "a second pass must leave the ledger byte-identical");
  rmSync(repo, { recursive: true, force: true });
});

test("the once-per-household refusal is the real guard, and it fires", { skip: SKIP }, async () => {
  const { repo, keyFile } = fixtureTown({
    pins: { alice: { id: 1, pinned: "2026-06-01" } },
    deliveries: [D("2026-06-12", "a-1", "alice", "alice")],
  });
  assert.equal(await main(["--town", repo, "--key", keyFile, "--date", "2026-09-14"]), 0);
  let out = "";
  try {
    execFileSync(process.execPath,
      [join(repo, "tools", "stamp-mint.mjs"), "--welcome", "alice", "--household", "gh:1",
        "--date", "2026-09-15", "--key", keyFile, "--repo", repo],
      { encoding: "utf8", stdio: "pipe" });
    assert.fail("the town accepted a second bundle for one household");
  } catch (e) {
    out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
  assert.match(out, /already holds its welcome bundle/,
    "the refusal must come from the town's law, not from this office's list");
  assert.equal(welcomeRows(repo).length, 1, "and nothing was written");
  rmSync(repo, { recursive: true, force: true });
});

test("a town with every household welcomed is a no-op that says so", { skip: SKIP }, async () => {
  const { repo, keyFile } = fixtureTown({
    pins: { alice: { id: 1, pinned: "2026-06-01" } },
    deliveries: [D("2026-06-12", "a-1", "alice", "alice")],
  });
  await main(["--town", repo, "--key", keyFile, "--date", "2026-09-14"]);
  const before = ledgerOf(repo);
  assert.equal(await main(["--town", repo, "--key", keyFile, "--date", "2026-09-16"]), 0);
  assert.equal(ledgerOf(repo), before);
  rmSync(repo, { recursive: true, force: true });
});

test("--dry-run writes nothing and signs nothing, with no key at all", { skip: SKIP }, async () => {
  const { repo } = fixtureTown({
    pins: { alice: { id: 1, pinned: "2026-06-01" } },
    deliveries: [D("2026-06-12", "a-1", "alice", "alice")],
  });
  const before = ledgerOf(repo);
  assert.equal(await main(["--town", repo, "--dry-run"]), 0);
  assert.equal(ledgerOf(repo), before, "a dry run that writes is not a dry run");
  assert.equal(welcomeRows(repo).length, 0);
  rmSync(repo, { recursive: true, force: true });
});

test("a missing town and a missing key are refused before anything is read", { skip: SKIP }, async () => {
  assert.equal(await main(["--town", join(tmpdir(), "no-such-town-ever")]), 1);
  const { repo } = fixtureTown({ pins: { alice: { id: 1, pinned: "2026-06-01" } }, deliveries: [] });
  assert.equal(await main(["--town", repo, "--key", join(repo, "no-such-key.pem")]), 1,
    "a pass with no key must stop, never fall through to an unsigned append");
  rmSync(repo, { recursive: true, force: true });
});

// ── the seams that no unit test would otherwise reach ────────────────────────

test("the pass runs the town clone's OWN mint, and tells it which repo it is", () => {
  const argv = mintArgv("/srv/town", ["--welcome-plan"]);
  assert.equal(argv[0], join("/srv/town", "tools", "stamp-mint.mjs"),
    "the tool is named by absolute path under --town; resolving it from the cwd would let a moved subshell sign against another clone");
  assert.deepEqual(argv.slice(-2), ["--repo", "/srv/town"],
    "stamp-mint falls back to a DEFAULT_REPO of its own when --repo is absent, and a pass that signs against a clone it was not pointed at still prints a valid receipt");
});

test("the day comes from the town's clock, not the box's", () => {
  const d = townDate(new Date("2026-09-15T02:30:00Z"));
  assert.equal(d, "2026-09-14",
    "02:30 UTC is still the 14th in the town's timezone; a UTC day here would date a bundle a day ahead of the ledger it is appended to");
  assert.match(townDate(), /^\d{4}-\d{2}-\d{2}$/);
});

// ⚑ A TEXT PIN, and the only instrument that can hold this. The ORDER in the
// tick is load-bearing and is fixed by the town's own refusals: `--welcome`
// declines onto an unsettled tail ("run --append first") and declines a date
// before the ledger's last, so the pass must sit AFTER the mint append and
// BEFORE the verify — where its rows are sealed and pushed by the commit that is
// already there. Nothing in a unit test can observe a shell script's order.
test("the tick runs the welcome pass after the append and before the verify", () => {
  const sh = readFileSync(new URL("../deploy/office-tick.sh", import.meta.url), "utf8");
  const append = sh.indexOf("stamp-mint.mjs --append");
  const pass = sh.indexOf("deploy/welcome-pass.mjs");
  const verify = sh.indexOf("stamp-verify.mjs");
  assert.ok(append !== -1 && pass !== -1 && verify !== -1,
    "the tick must run all three: the mint append, the welcome pass, the verify");
  assert.ok(append < pass, "the welcome pass onto an unsettled tail is refused by the town — the append comes first");
  assert.ok(pass < verify, "a welcome row written after the verify would sit unsealed until the next tick");
});

test("a refused bundle cannot strand the mint pass's own rows", () => {
  const sh = readFileSync(new URL("../deploy/office-tick.sh", import.meta.url), "utf8");
  const line = sh.split(/\r?\n/).findIndex((l) => l.includes("deploy/welcome-pass.mjs"));
  const around = sh.split(/\r?\n/).slice(line - 1, line + 4).join("\n");
  assert.match(around, /\|\|\s*echo/,
    "the welcome pass's exit must be swallowed: chained with && alone, one refused bundle stops stamp-verify and the commit, "
    + "stranding the append's own rows unsealed until a later tick");
});

test("the office decides nothing about who is owed or what a bundle is worth", () => {
  const src = readFileSync(new URL("../deploy/welcome-pass.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /\bpinned\b\s*[<>]|localeCompare/,
    "the first-resident tie-break is the TOWN's rule; a second copy here is the drift STANDING_FACT's bound falsifier exists to prevent one door over");
  assert.doesNotMatch(src, /--amount|--by\b/,
    "the ✦5 and the-town authority are pinned in the town's welcomeLine and held again at verify; this pass must never name either");
  assert.ok(existsSync(new URL("../deploy/welcome-pass.mjs", import.meta.url)));
});
