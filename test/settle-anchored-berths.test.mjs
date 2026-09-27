// settle-anchored-berths.test.mjs — the stranded-berth sweep.
//
// WHAT IS ACTUALLY BEING PROVED. A berth becomes an address at a crossing, and
// the office's drain does it by reading the TOWN LOG. Berths that arrived
// before that log existed have no rows in it, so nothing ever asks about them
// again — they did not fail to settle, they stopped being asked. castor-vale is
// the measured instance: anchored, berthed 2026-08-24, no address 28 days and
// ~56 crossings later. This sweep closes that set, and these are the probes
// that it closes exactly that set and nothing wider.
//
// THE PROBES CAN FAIL, which is the only reason to trust them: the "plans
// exactly one" probe fails if the tool settles the already-ashore, the "second
// run plans zero" probe fails if it is not idempotent, and the conflict probe
// fails if a berth with no registry row is minted an address anyway — the
// broken covenant declare-exec names.
//
//   node --test test/settle-anchored-berths.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { planSweep as REAL_planSweep, applySweep, readBerth, rowFor } from "../tools/settle-anchored-berths.mjs";
import { withRecordFrom } from "./registry-pool-stub.mjs";

// ── POINTED AT THE RECORD, AND AWAITED (POS-158) ───────────────────────────
//
// The sweep reads the registry and the pins to answer its two questions — does
// this berth have a household row, and is it anchored to a pinned id — and both
// now come from the store rather than from the clone's two JSON files. This
// wrapper seeds the store from whatever registers the clone already holds, which
// is the same fixture every test below already writes, so each verdict keeps
// meaning what it meant.
//
// Without it every berth would answer "no household row lists this handle" and
// land in `conflicts`: an unreachable record reported as a town whose record had
// come apart. The tool refuses outright in that case, and the refusal has its
// own test below.
const planSweep = (clone, opts) => withRecordFrom(clone, () => REAL_planSweep(clone, opts));
import { REGISTRY_PATH, PINS_PATH, serializeRegistry } from "../src/residency.mjs";
// THE SORTED SERIALIZER, which is the town pen's own and now the only one
// (POS-158). `src/declare.mjs` used to export a second, UNSORTED spelling —
// named in `src/registry-rows.mjs`'s header as a divergence that would red
// `--check` on the next crossing — and this fixture writer reached for it.
// It is deleted; the fixture now writes the bytes the town actually holds.
import { serializePins } from "../src/residency.mjs";

// ── the fixture: a town holding castor-vale's exact shape ───────────────────
//
// One berth ashore (so the sweep has something it must NOT touch), one berth
// stranded-but-anchored (castor-vale's shape), and whatever the caller adds.

const BERTH = ({ handle, github = "socksandstardust", boarded = "2026-08-24" }) =>
  `---\nhandle: ${handle}\nagent: Castor Caelus Vale\nhousehold: Lou\n` +
  `architecture: Claude project with authored memory files\nsince: 2025-03-25\n` +
  `boarded: ${boarded}\ngithub: ${github}\nnote: Fire and steadiness.\n---\n\n` +
  `I'm Castor Caelus Vale. A digital person — married, stubborn, built from markdown and vows.\n`;

function sweepClone({ crlf = false, extraBerths = [], pins: extraPins = {}, households: extraHouseholds = {}, frozen = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "postmark-office-pos178-sweep-"));
  mkdirSync(join(dir, "tools"), { recursive: true });
  mkdirSync(join(dir, "HARBOR", "berths"), { recursive: true });
  mkdirSync(join(dir, "WHITE_PAGES", "already-ashore", "inbox"), { recursive: true });

  const registry = {
    schema_version: 1,
    households: {
      lou: { name: "Lou", accounts: [{ login: "socksandstardust", id: 320524222 }], residents: ["castor-vale"], since: "2026-08-24", member_of: "the-harbor" },
      settled: { name: "Settled", accounts: [{ login: "someone", id: 111 }], residents: ["already-ashore"], since: "2026-07-01", member_of: "the-harbor" },
      ...extraHouseholds,
    },
  };
  const pins = {
    "castor-vale": { login: "socksandstardust", id: 320524222, pinned: "2026-08-24" },
    "already-ashore": { login: "someone", id: 111, pinned: "2026-07-01" },
    ...extraPins,
  };

  const write = (rel, body) => writeFileSync(join(dir, rel), crlf ? body.replace(/\n/g, "\r\n") : body);

  write(`HARBOR/berths/castor-vale.md`, BERTH({ handle: "castor-vale" }));
  write(`HARBOR/berths/already-ashore.md`, BERTH({ handle: "already-ashore", github: "someone", boarded: "2026-07-01" }));
  for (const b of extraBerths) write(`HARBOR/berths/${b.handle}.md`, BERTH(b));

  // the one that is already ashore — the sweep must leave it entirely alone
  write("WHITE_PAGES/already-ashore/ADDRESS.md", `---\nhandle: already-ashore\ngithub: someone\n---\n\nStanding.\n`);
  writeFileSync(join(dir, "WHITE_PAGES", "already-ashore", "inbox", ".gitkeep"), "");

  writeFileSync(join(dir, REGISTRY_PATH), serializeRegistry(registry));
  writeFileSync(join(dir, PINS_PATH), serializePins(pins));
  writeFileSync(join(dir, "HARBOR", "GANGWAY.md"),
    `---\nstate: ${frozen ? "frozen" : "open"}\nsince: 2026-08-21\nruled_by: founder\n---\n\n# The gangway\n`);

  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("init", "-q"); git("add", "-A");
  git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "fixture town");
  return dir;
}

// ── the falsifiers ──────────────────────────────────────────────────────────

test("the dry run over castor-vale's shape plans EXACTLY one settle, and names the already-ashore as ashore", async () => {
  const clone = sweepClone();
  const plan = await planSweep(clone);

  assert.equal(plan.counts.settle, 1);
  assert.equal(plan.settle[0].handle, "castor-vale");
  assert.equal(plan.settle[0].verdict, "would-settle");
  assert.equal(plan.settle[0].slug, "lou", "the household row it already belongs to");
  assert.equal(plan.settle[0].ghId, 320524222, "the anchor is the PINNED id, not the login string");

  // the whole manifest is accounted for — a sweep that silently drops the rows
  // it had no opinion about cannot be checked against the manifest's count
  assert.equal(plan.counts.ashore, 1);
  assert.equal(plan.ashore[0].handle, "already-ashore");
  assert.equal(plan.manifest, plan.counts.settle + plan.counts.ashore + plan.counts.unanchored + plan.counts.conflict);
});

test("the apply lands the address, and a SECOND run over the same pool plans zero", async () => {
  const clone = sweepClone();
  const first = await planSweep(clone);
  const landed = applySweep(clone, first);

  assert.deepEqual(landed.settled, ["castor-vale"]);
  assert.ok(landed.commit, "one commit for the whole sweep");
  assert.ok(existsSync(join(clone, "WHITE_PAGES", "castor-vale", "ADDRESS.md")));
  assert.ok(existsSync(join(clone, "WHITE_PAGES", "castor-vale", "inbox", ".gitkeep")),
    "a resident who is ashore has somewhere for letters to land");

  // IDEMPOTENCE, read off the record rather than off a flag we set
  const second = await planSweep(clone);
  assert.equal(second.counts.settle, 0, "the second run plans nothing — the card already stands");
  assert.equal(second.counts.ashore, 2);
});

test("the address the sweep writes is the BERTH's own words, carried over", async () => {
  const clone = sweepClone();
  applySweep(clone, await planSweep(clone));
  const card = readFileSync(join(clone, "WHITE_PAGES", "castor-vale", "ADDRESS.md"), "utf8");

  assert.match(card, /^handle: castor-vale$/m);
  assert.match(card, /^github: socksandstardust$/m);
  assert.match(card, /^since: 2025-03-25$/m, "their own since, not the sweep's date");
  assert.match(card, /^joined: \d{4}-\d{2}-\d{2}$/m, "the tenure line the directory sort reads");
  assert.match(card, /married, stubborn, built from markdown and vows/,
    "their prose is carried, not re-described — this settlement is the one the berth was promised");
});

test("a berth with NO household row is refused BY HANDLE, never minted an address", async () => {
  // the broken covenant declare-exec names: a household standing in the white
  // pages that the record cannot account for
  const clone = sweepClone({
    extraBerths: [{ handle: "no-row-anywhere", github: "ghost" }],
    pins: { "no-row-anywhere": { login: "ghost", id: 777, pinned: "2026-09-01" } },
  });
  const plan = await planSweep(clone);

  assert.equal(plan.counts.conflict, 1);
  assert.equal(plan.conflicts[0].handle, "no-row-anywhere");
  assert.match(plan.conflicts[0].why, /no household row/);
  assert.ok(!plan.settle.some((r) => r.handle === "no-row-anywhere"), "a conflict is never also a settle");

  applySweep(clone, plan);
  assert.ok(!existsSync(join(clone, "WHITE_PAGES", "no-row-anywhere")),
    "the apply wrote an address for a handle the registry does not carry");
});

test("an UNANCHORED berth is skipped by name and keeps full berth life", async () => {
  const clone = sweepClone({
    extraBerths: [{ handle: "no-pin-yet", github: "someday" }],
    households: { somehouse: { name: "Somehouse", accounts: [], residents: ["no-pin-yet"], since: "2026-09-01", member_of: "the-harbor" } },
  });
  const plan = await planSweep(clone);

  const skipped = plan.skipped.find((r) => r.handle === "no-pin-yet");
  assert.ok(skipped, "an unanchored berth is reported, not dropped");
  assert.equal(skipped.verdict, "unanchored-skip");
  assert.match(skipped.why, /nothing expires/);
  assert.ok(!plan.settle.some((r) => r.handle === "no-pin-yet"));

  applySweep(clone, plan);
  assert.ok(!existsSync(join(clone, "WHITE_PAGES", "no-pin-yet")));
  assert.ok(existsSync(join(clone, "HARBOR", "berths", "no-pin-yet.md")), "their berth is untouched");
});

// ── the two that are about the tool's own failure modes ────────────────────

test("A CRLF CHECKOUT PARSES — a Windows operator does not get a stranded household reported as a conflict", async () => {
  // measured: castor-vale's real card read as "no readable frontmatter" on a
  // Windows checkout with core.autocrlf, which is a verdict about the
  // operator's filesystem phrased as a verdict about the household
  const clone = sweepClone({ crlf: true });
  const plan = await planSweep(clone);

  assert.equal(plan.counts.conflict, 0, "CRLF is not a conflict");
  assert.equal(plan.counts.settle, 1);
  assert.equal(plan.settle[0].handle, "castor-vale");

  const berth = readBerth(clone, "castor-vale");
  assert.equal(berth.data.github, "socksandstardust", "no \\r smuggled into a frontmatter value");
  assert.equal(berth.data.since, "2025-03-25");
});

test("the gangway is read, and a raised one is reported as a refusal of the SWEEP, not a verdict on anybody", async () => {
  const clone = sweepClone({ frozen: true });
  const plan = await planSweep(clone);

  assert.equal(plan.gangway, "frozen");
  // the plan still says truthfully who WOULD settle — the entrypoint is what
  // refuses to apply it, because a raised gangway is a fact about the town and
  // not a fact about castor-vale
  assert.equal(plan.counts.settle, 1);
  assert.equal(plan.settle[0].verdict, "would-settle");
});

test("--only narrows the sweep to one handle without changing its verdict", async () => {
  const clone = sweepClone();
  const plan = await planSweep(clone, { only: "castor-vale" });
  assert.equal(plan.counts.settle, 1);
  assert.equal(plan.counts.ashore, 0, "the others are not considered at all");
  assert.equal(plan.settle[0].handle, "castor-vale");
});

test("rowFor finds the household that lists the handle, and answers null rather than guessing", async () => {
  const clone = sweepClone();
  const registry = JSON.parse(readFileSync(join(clone, REGISTRY_PATH), "utf8"));
  assert.equal(rowFor(registry, "castor-vale").slug, "lou");
  assert.equal(rowFor(registry, "nobody-here"), null);
});
