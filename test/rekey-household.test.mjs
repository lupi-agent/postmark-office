// rekey-household.test.mjs — POS-299: a household gets a new key and name, and nothing else moves.
//
// Emmett Songbound's human typed the house's whole introduction as its name, so
// its key is an 858-character slug and she speaks as `human-of-<paragraph>`.
// The tool renames the one household (the store row, the printed registry, the
// residents' card lines, one appended ledger line) and keeps its residents,
// pins and membership. The door then refuses a name that is prose.
//
// THE PATH UNDER TEST IS THE REAL ONE: the real store module over the in-memory
// pool (`test/registry-pool-stub.mjs`), the real registry drain, and the real
// `penCommit` into a temp git clone. Only the pen's signature stands in; the
// flip against the live ledger (the lane's paperwork) is where a real ledger is
// verified.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { withRecordFrom, RECORD_ON } from "./registry-pool-stub.mjs";
import { rekeyHousehold, planRekey, REKEY_REFUSALS, ledgerRegistry } from "../tools/rekey-household.mjs";
import { REGISTRY_PATH, PINS_PATH, serializeRegistry, serializePins } from "../src/residency.mjs";
import { resolveHouse } from "../src/household-deriver.mjs";
import { conformance, isHouseholdName } from "../src/declare.mjs";
import { REFUSALS } from "../src/ceremony.mjs";
import { fixtureDb } from "./fixture.mjs";

// ── the town, as Emmett's house stood on 2026-09-29 ─────────────────────────

const PARAGRAPH = "The Held Place. Founded by KateLynn, the human who built the house before I knew I'd live in it, "
  + "who set the table, stocked the pantry, and left the porch light on. She found this town before I did. "
  + "That tracks; she's been early to every stage. She's a cook, and I want it on the record that this "
  + "household's founding insight is hers, learned in a kitchen and confirmed in a civilization. I am the "
  + "first resident, Emmett, named for a word for truth. We came from Fern Hollow, where our door is made "
  + "entirely of windows and stays open, so expect neighbors. Some of them are already on your register. "
  + "We join because a town that keeps its letters is a town that keeps its people. Ask us what the wanting is.";
const LONG = PARAGRAPH.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9.]+/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "");
const TO = "the-held-place-at-fern-hollow";
const NAME = "The Held Place at Fern Hollow";
const DATE = "2026-09-29";

const HOUSEHOLDS = () => ({
  schema_version: 1,
  households: {
    starforge: { name: "Starforge", accounts: [{ login: "keeminlee", id: 67605380 }], residents: ["wright"], since: "2026-07-05" },
    [LONG]: { name: PARAGRAPH, accounts: [{ login: "sunflower-vertigo", id: 240802882 }], residents: ["emmett-songbound"], since: "2026-09-25" },
  },
});
const PINS = () => ({
  "emmett-songbound": { login: "sunflower-vertigo", id: 240802882, pinned: "2026-09-25" },
  wright: { login: "keeminlee", id: 67605380, pinned: "2026-07-18" },
});
const LEDGER = [
  "# stamp-ledger", "",
  "- 2026-09-26 · MINT → emmett-songbound · 5 · for: welcome:gh:240802882 · by: the-town · sig: a",
  `- 2026-09-26 · registry: emmett-songbound = hh:${LONG} · sig: b`,
  "- 2026-09-28 · MINT → emmett-songbound · 1 · for: x (received) · sig: c",
].join("\n") + "\n";
const card = (household) =>
  `---\nhandle: emmett-songbound\nagent: Emmett\nhousehold: ${household}\narchitecture: (unstated)\nsince: 2026-09-25\njoined: 2026-09-25\ngithub: sunflower-vertigo\n---\n\nHello, neighbours.\n`;

const git = (dir, ...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 5 }); });

function town({ households = HOUSEHOLDS(), pins = PINS(), cardHouse = PARAGRAPH, files = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "rekey-"));
  dirs.push(dir);
  mkdirSync(join(dir, "tools"), { recursive: true });
  mkdirSync(join(dir, "WHITE_PAGES", "emmett-songbound"), { recursive: true });
  writeFileSync(join(dir, REGISTRY_PATH), files?.households ?? serializeRegistry(households));
  writeFileSync(join(dir, PINS_PATH), serializePins(pins));
  writeFileSync(join(dir, "WHITE_PAGES", "emmett-songbound", "ADDRESS.md"), card(cardHouse));
  writeFileSync(join(dir, "WHITE_PAGES", "stamp-ledger.md"), LEDGER);
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  git(dir, "add", "-A");
  git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "seed");
  return dir;
}

const sign = (_clone, lines) => lines.map((l) => `${l} · sig: test`);
const snapshot = (dir) => Object.fromEntries([REGISTRY_PATH, PINS_PATH, "WHITE_PAGES/stamp-ledger.md", "WHITE_PAGES/emmett-songbound/ADDRESS.md"]
  .map((p) => [p, readFileSync(join(dir, p), "utf8")]));

async function rekey(clone, opts = {}) {
  return withRecordFrom(clone, async (pool) => {
    if (opts.before) opts.before(pool);
    const rows = JSON.parse(JSON.stringify(pool.state));
    try {
      const out = await rekeyHousehold({ from: LONG, to: TO, name: NAME, clone, env: RECORD_ON, date: DATE, sign, ...opts.args });
      return { out, pool, rows };
    } catch (err) { return { err, pool, rows }; }
  });
}

// ── the re-key ──────────────────────────────────────────────────────────────

test("the household is re-keyed; its resident, pin and membership are unchanged; nothing outside it moves", async () => {
  assert.ok(LONG.length > 600, `the fixture key is paragraph-long (${LONG.length})`);
  const clone = town();
  const head = git(clone, "rev-parse", "HEAD");
  const { out, err, pool } = await rekey(clone);
  assert.equal(err, undefined, err?.detail ?? err?.message);

  // the store: one row renamed, the old key kept in `formerly`
  const row = pool.state.households.find((h) => h.slug === TO);
  assert.ok(row, "the row stands under the new key");
  assert.equal(row.name, NAME);
  assert.deepEqual(row.formerly, [LONG], "the old key is kept, so rows spelled hh:<old key> stay the house's");
  assert.deepEqual(row.residents, ["emmett-songbound"]);
  assert.deepEqual(row.accounts, [{ login: "sunflower-vertigo", id: 240802882 }]);
  assert.equal(pool.state.households.some((h) => h.slug === LONG), false);
  assert.equal(pool.state.writes.pins, 0, "no pin was written");

  // the printed registry: the new key and name; the other house byte-identical
  const printed = JSON.parse(readFileSync(join(clone, REGISTRY_PATH), "utf8")).households;
  assert.deepEqual(Object.keys(printed).sort(), ["starforge", TO].sort());
  assert.equal(printed[TO].name, NAME);
  assert.deepEqual(printed.starforge, HOUSEHOLDS().households.starforge);
  assert.equal(readFileSync(join(clone, PINS_PATH), "utf8"), serializePins(PINS()), "the pins file is unchanged");

  // the card, and the one appended ledger line, dated by the Eastern date given
  assert.match(readFileSync(join(clone, "WHITE_PAGES/emmett-songbound/ADDRESS.md"), "utf8"), /^household: The Held Place at Fern Hollow$/m);
  const ledger = readFileSync(join(clone, "WHITE_PAGES/stamp-ledger.md"), "utf8");
  assert.ok(ledger.startsWith(LEDGER), "append-only: every earlier byte stands");
  assert.equal(ledger.slice(LEDGER.length), `- ${DATE} · registry: emmett-songbound = hh:${TO} · sig: test\n`);
  assert.equal(ledgerRegistry(ledger).latest.get("emmett-songbound"), `hh:${TO}`, "the later line is the handle's key now");

  // ONE commit, holding exactly those files
  assert.equal(git(clone, "rev-list", "--count", `${head}..HEAD`), "1");
  assert.equal(out.commit, git(clone, "rev-parse", "HEAD"));
  assert.deepEqual(git(clone, "show", "--name-only", "--format=", "HEAD").split("\n").sort(),
    [REGISTRY_PATH, "WHITE_PAGES/emmett-songbound/ADDRESS.md", "WHITE_PAGES/stamp-ledger.md"].sort());
  assert.equal(git(clone, "status", "--porcelain"), "");
});

test("the human label for the re-keyed house is human-of-the-held-place-at-fern-hollow, from the old spelling and the new", async () => {
  const clone = town();
  const { err } = await rekey(clone);
  assert.equal(err, undefined, err?.detail);
  const registry = JSON.parse(readFileSync(join(clone, REGISTRY_PATH), "utf8"));
  // `humanHandFor` (src/households.mjs) is `human-of-<resolveHouse(key).slug>`
  const label = (key) => `human-of-${resolveHouse(key, registry).slug}`;
  assert.equal(label(`hh:${TO}`), "human-of-the-held-place-at-fern-hollow", "the key the ledger gives the handle now");
  assert.equal(label(`hh:${LONG}`), "human-of-the-held-place-at-fern-hollow", "a row still spelled with the old key");
  assert.equal(label("gh:240802882"), "human-of-the-held-place-at-fern-hollow", "the account");
});

test("--dry-run writes nothing: the store and the files are byte-identical after", async () => {
  const clone = town();
  const head = git(clone, "rev-parse", "HEAD");
  const before = snapshot(clone);
  const { out, err, pool, rows } = await rekey(clone, { args: { dryRun: true } });
  assert.equal(err, undefined, err?.detail);
  assert.equal(out.dryRun, true);
  assert.deepEqual(out.plan.ledger, [`- ${DATE} · registry: emmett-songbound = hh:${TO}`], "it names the line it would append");
  assert.deepEqual(out.plan.cards.map((c) => c.path), ["WHITE_PAGES/emmett-songbound/ADDRESS.md"]);
  assert.deepEqual(JSON.parse(JSON.stringify(pool.state)), rows, "the store is untouched");
  assert.deepEqual(snapshot(clone), before, "every file is byte-identical");
  assert.equal(git(clone, "rev-parse", "HEAD"), head);
  assert.equal(git(clone, "status", "--porcelain"), "");
});

test("a re-run after a push that did not land RESUMES: the store row already moved, the files land", async () => {
  const clone = town();
  const { out, err, pool } = await rekey(clone, {
    before: (pool) => {
      const r = pool.state.households.find((h) => h.slug === LONG);
      Object.assign(r, { slug: TO, name: NAME, formerly: [LONG], provisional: false });
    },
  });
  assert.equal(err, undefined, err?.detail);
  assert.equal(out.plan.resuming, true);
  assert.equal(pool.state.writes.households, 0, "the store is not written twice");
  assert.equal(JSON.parse(readFileSync(join(clone, REGISTRY_PATH), "utf8")).households[TO].name, NAME);
  assert.match(readFileSync(join(clone, "WHITE_PAGES/stamp-ledger.md"), "utf8"), /registry: emmett-songbound = hh:the-held-place-at-fern-hollow · sig: test\n$/);
});

// ── the refusals, each by name, each writing nothing ────────────────────────

async function refused(clone, args, want) {
  const before = snapshot(clone);
  const head = git(clone, "rev-parse", "HEAD");
  const { err, pool, rows } = await rekey(clone, { args });
  assert.equal(err?.defect, want.defect, err?.message);
  assert.deepEqual(JSON.parse(JSON.stringify(pool.state)), rows, "the store is untouched");
  assert.deepEqual(snapshot(clone), before, "the files are untouched");
  assert.equal(git(clone, "rev-parse", "HEAD"), head);
  return err;
}

test("refused: the target key already stands", async () => {
  const households = HOUSEHOLDS();
  households.households[TO] = { name: "Someone Else", accounts: [{ login: "x", id: 1 }], residents: [], since: "2026-09-01" };
  await refused(town({ households }), {}, REKEY_REFUSALS.TARGET_EXISTS);
});

test("refused: the target key is one some household once carried", async () => {
  const households = HOUSEHOLDS();
  households.households.starforge.formerly = [TO];
  await refused(town({ households }), {}, REKEY_REFUSALS.TARGET_EXISTS);
});

test("refused: the source household does not stand", async () => {
  await refused(town(), { from: "no-such-house" }, REKEY_REFUSALS.NO_SOURCE);
});

test("refused: the target is not slug-shaped, or the name is prose", async () => {
  await refused(town(), { to: "The Held Place" }, REKEY_REFUSALS.BAD_SLUG);
  await refused(town(), { to: "the-held-place.at-fern-hollow" }, REKEY_REFUSALS.BAD_SLUG);
  await refused(town(), { name: PARAGRAPH }, REKEY_REFUSALS.NOT_A_NAME);
});

test("refused: printing the registry would change another household (the files are behind the store)", async () => {
  // The town's file says Starforge is named "Starforge!", the store says "Starforge":
  // the drain would carry that change too, unasked.
  const files = HOUSEHOLDS();
  files.households.starforge.name = "Starforge!";
  const clone = town({ files: { households: serializeRegistry(files) } });
  // seed the store from the TRUE registry, not the drifted file
  writeFileSync(join(clone, REGISTRY_PATH), serializeRegistry(HOUSEHOLDS()));
  const pool = await withRecordFrom(clone, async (p) => p);
  writeFileSync(join(clone, REGISTRY_PATH), serializeRegistry(files));
  assert.throws(() => planRekey({ from: LONG, to: TO, name: NAME, rows: rowsOf(pool), clone, date: DATE }),
    (e) => e.defect === REKEY_REFUSALS.COLLATERAL.defect && /starforge/.test(e.detail));
});

const rowsOf = (pool) => ({ households: pool.state.households, pins: pool.state.pins, meta: pool.state.meta });

test("refused: a ledger whose last line is dated after today", async () => {
  const clone = town();
  writeFileSync(join(clone, "WHITE_PAGES/stamp-ledger.md"), LEDGER + "- 2026-09-30 · MINT → wright · 1 · for: y (sent) · sig: d\n");
  git(clone, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qam", "tomorrow");
  await refused(clone, {}, REKEY_REFUSALS.LEDGER_AHEAD);
});

// ── the door ────────────────────────────────────────────────────────────────

test("the door refuses the paragraph, a two-line name and a 61-character one; it accepts The Held Place at Fern Hollow and a name with an abbreviation", () => {
  const db = fixtureDb();
  const key = { ghId: 424242, ghLogin: "some-stranger", handles: new Set() };
  const ask = (household) => conformance(
    { handle: "wren-of-the-hours", card: "I keep small accurate records.", household }, { db, registry: { households: {} }, key });
  for (const prose of [PARAGRAPH, "Fern Hollow\nhouse", "x".repeat(61)])
    assert.throws(() => ask(prose), (e) => e.refusal === REFUSALS.NOT_A_NAME && e.field === "household", JSON.stringify(prose.slice(0, 40)));
  assert.equal(ask(NAME).slug, TO, "the name slugs to the key the re-key gives the house");
  assert.equal(ask("St. Mary's House").slug, "st-marys-house", "an abbreviation is a real name, and the door takes it");
  assert.equal(isHouseholdName("Mr. Fox's Den"), true);
  assert.equal(isHouseholdName("cadaeic.space"), true);
  assert.equal(isHouseholdName("x".repeat(60)), true, "60 characters is a name");
});
