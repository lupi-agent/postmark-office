// bug-stage-plan.test.mjs — the stage stamps the town owes, and the reviewed pass that pays them.
//
//   node --test test/bug-stage-plan.test.mjs
//   STAGE_MINT_TOWN=<town tree carrying --stage-mint> node --test test/bug-stage-plan.test.mjs
//
// The gate, in its order (the brief, 2026-09-29):
//
//   1. the plan lists 2 stamps for a confirmed bug, owed to its reporter;
//   2. the fourth confirmed report by one household in a week pays 0 and says
//      "capped"; two residents of one house share the cap, and the store's
//      resolver decides the house;
//   3. credit to a meep pays 0 and says "meep"; (Wright's review of #257) a
//      resident no household holds pays 0 and says "unresolved", and two of
//      them share no cap;
//   4. the pass is bound to its own plan: a count the rows do not match refuses;
//   5. after --apply, the ledger holds exactly one signed `post:<id>/confirmed`
//      line, and a second --apply writes nothing.
//   6. (POS-298) the critter the fixer names on the advance to fixed changes
//      no amount: the plan is the same with the name and without it.
//
// 5 runs the TOWN'S OWN verb, so it needs a town whose stamp-mint.mjs carries
// --stage-mint. The office's pinned town-clone gains it when the town branch
// posts/bug-stage-mint lands; until then 5 SKIPS, and says why in its own
// name, rather than proving nothing green. Point STAGE_MINT_TOWN at a town tree
// that carries the verb to run it.
//
// ⚑ THE STORE IS A JS STUB (`acts-pen-stub.mjs`): the acts are written by the
// real door and read back by the plan's own store query.
//
// THE FLIPS (NOTES.md in the lane folder holds their red lines): drop the cap
// and 2 goes red; drop the meep check and 3 goes red.

import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { installActsPen, uninstallActsPen, RECORD_ON } from "./acts-pen-stub.mjs";
import { OFFICE_ROOT } from "./fixture-paths.mjs";

Object.assign(process.env, RECORD_ON);
const { postAtTown, advanceAtTown } = await import("../src/events-store.mjs");
const { planStages, renderPlan, parseStagePlan, storeFacts, weekOf, main } = await import("../tools/bug-stage-plan.mjs");

const NOW = Date.now();
const WRIGHT = { household: "starforge", handles: new Set(["wright"]) };
const key = (h) => ({ household: h, handles: new Set([h]) });

// ada and bram keep one house; carol keeps her own. dan and eve are residents no house holds.
const HOUSES = [{ slug: "the-harbor", ord: 1, residents: ["ada", "bram"] }, { slug: "carols", ord: 2, residents: ["carol"] }];
const ROLL = new Set(["wright", "ada", "bram", "carol", "dan", "eve", "bugcatcher"]);

function bugTables() {
  const posts = new Map();
  const PC = ["id", "class", "title", "body", "author", "household", "place_mark", "place_x", "place_y",
    "starts", "ends", "state", "fields", "revised", "posted_act", "last_act"];
  const asJson = (v) => (typeof v === "string" ? JSON.parse(v) : v);
  return [
    [/^INSERT INTO posts/i, (q, p) => { const r = Object.fromEntries(PC.map((k, i) => [k, p[i]])); r.fields = asJson(r.fields); posts.set(p[0], r); return { rows: [], rowCount: 1 }; }],
    [/^UPDATE posts SET/i, (q, p) => { Object.assign(posts.get(p[0]), { state: p[8], fields: asJson(p[9]), revised: p[10], last_act: p[11] }); return { rows: [], rowCount: 1 }; }],
    [/FROM posts WHERE id = \$1 AND class = \$2$/i, (q, p) => { const r = posts.get(p[0]); const hit = r && r.class === p[1]; return { rows: hit ? [{ ...r, fields: { ...r.fields } }] : [], rowCount: hit ? 1 : 0 }; }],
    [/^SELECT id, state, ends FROM posts WHERE id LIKE \$1$/i, (q, p) => { const pre = p[0].replace(/%$/, ""); const rows = [...posts.values()].filter((r) => r.id.startsWith(pre)); return { rows, rowCount: rows.length }; }],
  ];
}
function setup() { return installActsPen({ households: HOUSES, also: bugTables() }); }
test.afterEach(() => uninstallActsPen());

/** Post a bug by `who` and confirm it by a hand; returns its id. */
async function confirmed(who, title) {
  const r = await postAtTown({ class: "bug", title, body: "It broke." }, key(who), { now: NOW, roll: ROLL });
  await advanceAtTown({ post: r.post.id, to: "confirmed" }, WRIGHT, { now: NOW, roll: ROLL });
  return r.post.id;
}
const noMeeps = () => false;
async function plan({ isMeep = noMeeps, paid = new Set() } = {}) {
  const facts = await storeFacts();
  return planStages({ acts: facts.acts, houseOf: (h) => facts.houses.get(h) ?? null, isMeep, paid });
}

// ── 1 ───────────────────────────────────────────────────────────────────────

test("1 · the plan lists 2 stamps for a confirmed bug, owed to its reporter, with the household the store resolves", async () => {
  setup();
  const id = await confirmed("carol", "The map drifts");
  const rows = await plan();
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].post, rows[0].stage, rows[0].handle, rows[0].household, rows[0].n, rows[0].why, rows[0].owed],
    [id, "confirmed", "carol", "hh:carols", 2, "owed", true]);
  const text = renderPlan(rows);
  assert.match(text, /^bug stage plan — 1 paid stage\(s\) recorded, 0 already paid, 0 pay nothing, 1 owed \(2 stamps\)$/m);
  assert.match(text, /^ {2}carol\/the-map-drifts\/confirmed · carol · hh:carols · 2 · owed · act \d+ on \d{4}-\d{2}-\d{2}$/m);
  // a stage already in the ledger is named, and not owed again
  const again = await plan({ paid: new Set([`${id}/confirmed`]) });
  assert.deepEqual([again[0].why, again[0].owed], ["already paid", false]);
});

// ── 2 ───────────────────────────────────────────────────────────────────────

test("2 · the fourth confirmed report by one household in a week pays 0 and says capped; two residents share the cap; the resolver decides the house", async () => {
  setup();
  // ada twice, bram twice: one house, four confirmed reports, one week. carol (her own house) once.
  await confirmed("ada", "One");
  await confirmed("bram", "Two");
  await confirmed("ada", "Three");
  await confirmed("carol", "Four");
  const fourth = await confirmed("bram", "Five");
  const rows = await plan();
  const byPost = new Map(rows.map((r) => [r.post, r]));
  assert.deepEqual(rows.filter((r) => r.household === "hh:the-harbor").map((r) => r.n), [2, 2, 2, 0]);
  const capped = byPost.get(fourth);
  assert.equal(capped.n, 0);
  assert.equal(capped.owed, false);
  assert.match(capped.why, /^capped: hh:the-harbor already has 3 paid confirmed reports the week of \d{4}-\d{2}-\d{2}$/);
  assert.equal(byPost.get("carol/four").n, 2, "another house's report is not capped by the harbor's");
  assert.match(renderPlan(rows), /PAYS NOTHING\n {2}bram\/five\/confirmed · bram · hh:the-harbor · 0 · capped/);
  // later stages are uncapped
  await advanceAtTown({ post: fourth, to: "reproduced", credit: "bram" }, WRIGHT, { now: NOW, roll: ROLL });
  const later = (await plan()).find((r) => r.post === fourth && r.stage === "reproduced");
  assert.deepEqual([later.n, later.owed], [3, true]);
});

test("2 · the week is Monday to Sunday in the town's time", () => {
  // Sunday 2026-10-04 23:30 EDT is 2026-10-05 03:30Z — still the week of Monday 09-28 in town
  assert.equal(weekOf("2026-10-05T03:30:00Z", "America/New_York"), "2026-09-28");
  assert.equal(weekOf("2026-10-05T04:30:00Z", "America/New_York"), "2026-10-05");
});

// ── 3 ───────────────────────────────────────────────────────────────────────

test("3 · credit to a meep pays 0 and says meep; the meep's report does not use its house's cap", async () => {
  setup();
  const id = await confirmed("carol", "Wires crossed");
  await advanceAtTown({ post: id, to: "reproduced", credit: "bugcatcher" }, WRIGHT, { now: NOW, roll: ROLL });
  const rows = await plan({ isMeep: (h) => h === "bugcatcher" });
  const r = rows.find((x) => x.stage === "reproduced");
  assert.deepEqual([r.handle, r.n, r.owed], ["bugcatcher", 0, false]);
  assert.match(r.why, /^meep: a meep never receives stamps$/);
  assert.equal(rows.find((x) => x.stage === "confirmed").n, 2);
});

test("3 · a resident no household holds pays 0 and says unresolved; two of them are neither paid nor capped together", async () => {
  setup();
  // four each: were they one bucket, the fourth would be "capped"; were they paid, they'd be owed
  for (const who of ["dan", "eve"]) for (const t of ["One", "Two", "Three", "Four"]) await confirmed(who, `${who} ${t}`);
  const rows = await plan();
  assert.equal(rows.length, 8);
  for (const r of rows) {
    assert.deepEqual([r.n, r.owed, r.household], [0, false, "(none)"], r.post);
    assert.match(r.why, new RegExp(`^unresolved: ${r.handle} has no household on record; a person binds them, then the plan pays$`));
  }
  assert.ok(!rows.some((r) => /capped/.test(r.why)), "unresolved residents were capped together");
  assert.match(renderPlan(rows), /0 owed \(0 stamps\)/);
});

// ── 4 ───────────────────────────────────────────────────────────────────────

test("4 · the pass is bound to its own plan: a header whose count the rows do not match refuses", () => {
  const rows = [{ post: "carol/x", stage: "confirmed", handle: "carol", household: "solo:carol", n: 2, why: "owed", owed: true, act: 7, date: "2026-09-29" }];
  const text = renderPlan(rows);
  assert.deepEqual(parseStagePlan(text).owed.map((r) => [r.post, r.stage, r.handle, r.n]), [["carol/x", "confirmed", "carol", 2]]);
  assert.throws(() => parseStagePlan(text.replace("1 owed (2 stamps)", "2 owed (4 stamps)")), /the plan says 2 owed and this pass parsed 1/);
  assert.throws(() => parseStagePlan(text.replace("bug stage plan —", "stage plan —")), /printed no header/);
  assert.throws(() => parseStagePlan(text.replace(" · owed · ", " · due · ")), /unreadable owed row/);
});

// ── 5 · the whole pass, through the town's own verb ─────────────────────────

const TOWN_SRC = process.env.STAGE_MINT_TOWN ?? join(OFFICE_ROOT, "town-clone");
const TOWN_HAS_VERB = existsSync(join(TOWN_SRC, "tools", "stamp-mint.mjs"))
  && readFileSync(join(TOWN_SRC, "tools", "stamp-mint.mjs"), "utf8").includes("'--stage-mint'");

/** A founded synthetic town carrying the town's own stamp-mint and stamp-verify. */
function syntheticTown() {
  const repo = mkdtempSync(join(tmpdir(), "bug-stage-town-"));
  mkdirSync(join(repo, "tools"), { recursive: true });
  mkdirSync(join(repo, "WHITE_PAGES"), { recursive: true });
  for (const f of ["stamp-mint.mjs", "stamp-verify.mjs"]) copyFileSync(join(TOWN_SRC, "tools", f), join(repo, "tools", f));
  writeFileSync(join(repo, "tools", "github-ids.json"), JSON.stringify({ carol: { id: 3 }, dan: { id: 4 } }));
  for (const h of ["carol", "dan"]) {
    mkdirSync(join(repo, "WHITE_PAGES", h), { recursive: true });
    writeFileSync(join(repo, "WHITE_PAGES", h, "ADDRESS.md"), `---\nhandle: ${h}\n---\n`);
  }
  writeFileSync(join(repo, "WHITE_PAGES", "mail-ledger.md"), "# ledger\n\n- 2026-06-12 · a-1 · carol → dan · thread: new\n");
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  writeFileSync(join(repo, "tools", "stamp-pubkey.pem"), publicKey.export({ type: "spki", format: "pem" }));
  const keyFile = join(repo, "stamp-key.pem");
  writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }));
  execFileSync(process.execPath, [join(repo, "tools", "stamp-mint.mjs"), "--append", "--key", keyFile, "--repo", repo], { encoding: "utf8" });
  return { repo, keyFile };
}
const stageLinesOf = (repo) => readFileSync(join(repo, "WHITE_PAGES", "stamp-ledger.md"), "utf8").split(/\r?\n/).filter((l) => l.includes("for: post:"));

test("5 · after --apply the ledger holds exactly one signed post:<id>/confirmed line, it verifies, and a second --apply writes nothing",
  { skip: TOWN_HAS_VERB ? false : `the town at ${TOWN_SRC} has no --stage-mint yet (the town branch posts/bug-stage-mint); set STAGE_MINT_TOWN to a town tree that carries it` },
  async () => {
    setup();
    const id = await confirmed("carol", "The map drifts");
    const { repo, keyFile } = syntheticTown();
    try {
      const out = [];
      const facts = await storeFacts();
      const argv = ["--town", repo, "--apply", "--key", keyFile, "--date", "2026-09-29"];
      const first = await main(argv, { facts, log: (s) => out.push(s), err: (s) => out.push(`ERR ${s}`) });
      assert.equal(first, 0, out.join("\n"));
      const lines = stageLinesOf(repo);
      assert.equal(lines.length, 1, lines.join("\n"));
      assert.match(lines[0], new RegExp(`^- 2026-09-29 · MINT → carol · 2 · for: post:${id.replace("/", "\\/")}/confirmed · by: the-town · sig: \\S+$`));
      const verify = spawnSync(process.execPath, [join(repo, "tools", "stamp-verify.mjs"), "--repo", repo], { encoding: "utf8" });
      assert.equal(verify.status, 0, verify.stdout + verify.stderr);

      const second = [];
      const again = await main(argv, { facts: await storeFacts(), log: (s) => second.push(s), err: (s) => second.push(`ERR ${s}`) });
      assert.equal(again, 0, second.join("\n"));
      assert.match(second.join("\n"), /0 owed \(0 stamps\)/);
      assert.match(second.join("\n"), /ALREADY PAID\n {2}carol\/the-map-drifts\/confirmed · carol · hh:carols · 2 · already paid/);
      assert.equal(stageLinesOf(repo).length, 1, "a second --apply wrote a line");
    } finally { rmSync(repo, { recursive: true, force: true }); }
  });

test("7 · --quiet (the tick's): a run that pays prints the header and the owed rows only; a run with nothing owed prints nothing",
  { skip: TOWN_HAS_VERB ? false : `the town at ${TOWN_SRC} has no --stage-mint yet; set STAGE_MINT_TOWN to a town tree that carries it` },
  async () => {
    setup();
    await confirmed("carol", "The map drifts");
    const { repo, keyFile } = syntheticTown();
    try {
      const argv = ["--town", repo, "--apply", "--quiet", "--key", keyFile, "--date", "2026-09-29"];
      const first = [];
      assert.equal(await main(argv, { facts: await storeFacts(), log: (s) => first.push(s), err: (s) => first.push(`ERR ${s}`) }), 0, first.join("\n"));
      const said = first.join("\n");
      assert.match(said, /1 owed \(2 stamps\)/);
      assert.match(said, /OWED\n {2}carol\/the-map-drifts\/confirmed/);
      assert.match(said, /minted 2 → carol/);
      assert.doesNotMatch(said, /ALREADY PAID|PAYS NOTHING/);
      const second = [];
      assert.equal(await main(argv, { facts: await storeFacts(), log: (s) => second.push(s), err: (s) => second.push(`ERR ${s}`) }), 0, second.join("\n"));
      assert.deepEqual(second, [], "a quiet tick with nothing owed says nothing");
      assert.equal(stageLinesOf(repo).length, 1);
    } finally { rmSync(repo, { recursive: true, force: true }); }
  });

test("5 · the pass refuses a town whose stamp-mint has no stage grammar, before reading anything", async () => {
  const repo = mkdtempSync(join(tmpdir(), "bug-stage-old-"));
  mkdirSync(join(repo, "tools"), { recursive: true });
  writeFileSync(join(repo, "tools", "stamp-mint.mjs"), "export const classifyEntry = () => ({ kind: 'unknown' });\n");
  const errs = [];
  const code = await main(["--town", repo], { facts: { acts: [], houses: new Map() }, log: () => {}, err: (s) => errs.push(s) });
  assert.equal(code, 1);
  assert.match(errs.join("\n"), /has no stage grammar/);
  rmSync(repo, { recursive: true, force: true });
});

// ── 6 ───────────────────────────────────────────────────────────────────────

test("6 · (POS-298) the critter changes no amount: the plan for a fixed bug is the same with and without its name", async () => {
  setup();
  const r = await postAtTown({ class: "bug", title: "The bell rings twice", body: "It broke." }, key("carol"), { now: NOW, roll: ROLL });
  for (const [to, more] of [["diagnosed", {}], ["briefed", { grade: "heavy" }], ["fixed", { size: "L", critter: "Double Dinger" }]])
    await advanceAtTown({ post: r.post.id, to, credit: "ada", ...more }, WRIGHT, { now: NOW, roll: ROLL });
  const facts = await storeFacts();
  const fixedAct = facts.acts.find((a) => (typeof a.payload === "string" ? JSON.parse(a.payload) : a.payload).to === "fixed");
  assert.ok(fixedAct, "the fixed advance is in the store's acts");
  const nameless = facts.acts.map((a) => {
    const p = typeof a.payload === "string" ? JSON.parse(a.payload) : a.payload;
    if (!p.fields?.critter) return a;
    const { critter, named_by, ...rest } = p.fields;
    assert.deepEqual([critter, named_by], ["Double Dinger", "ada"]);
    return { ...a, payload: JSON.stringify({ ...p, fields: rest }) };
  });
  const houseOf = (h) => facts.houses.get(h) ?? null;
  const withName = planStages({ acts: facts.acts, houseOf, isMeep: noMeeps });
  const without = planStages({ acts: nameless, houseOf, isMeep: noMeeps });
  assert.deepEqual(withName, without);
  assert.deepEqual(withName.map((x) => [x.stage, x.n]), [["diagnosed", 5], ["briefed", 5], ["fixed", 50]]);
});
