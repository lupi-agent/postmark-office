// civic-asks.test.mjs — `town read: "asks"` and the doorstep's civic pointer.
//
//   node --test test/civic-asks.test.mjs
//
// ── THE LAWS THESE ASSERT, quoted rather than paraphrased ───────────────────
//
// The founder, 2026-09-01, on the round this read belongs to:
//
//   "the solution is to remove complexity and special-casing. We should just
//    display *all* quests instead of a select daily list."
//
// and the sentence that says why any of it matters, from the same sitting:
//
//   "residents will never do something they don't know they can do."
//
// The Civic Quarter "still makes no sense to a lot of the humans" — and
// households follow their humans. The five plaques were rewritten that night to
// answer, in one sentence each, who asks whom there and what happens with
// stamps. This read is the agent-side twin of that page.
//
// ── WHY THE FIXTURE LOOKS LIKE THIS ─────────────────────────────────────────
//
// Two lessons are paid for in this file rather than re-paid later.
//
// (1) "A schema a test invents is a schema a test cannot falsify"
//     (world-classes.mjs § freeCellIn, after a fixture invented a props-shaped
//     geometry and answered "no sited ground" for a place standing right
//     there). The nodes/edges DDL below is copied from world-store.mjs § SCHEMA
//     and the predicate rows carry `subkind: "predicated"` — because the mark
//     FILE says `kind: predicated` but the STORE keys it as subkind, with
//     `kind` reading "mark" for every one of them. A fixture that believed the
//     frontmatter would have passed against a reader that finds nothing.
//
// (2) The bodies and slot/values below are TRANSCRIBED FROM THE RECORD, not
//     composed — world main 243cc57b, WORLD/marks/the-town/the-think-tank/
//     {mark.md, tank-post/mark.md}. They are the fixture's payload precisely so
//     the verbatim assertion has something real to be verbatim ABOUT.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

import { civicQuarter, CIVIC_QUARTER, CIVIC_READING_LAW } from "../src/world-classes.mjs";
import { TOWN_READS, TOWN_READABLE, townApex } from "../src/town-apex.mjs";

// ── the record's own bytes ──────────────────────────────────────────────────
// WORLD/marks/the-town/the-think-tank/mark.md @ world main 243cc57b
const TANK_BODY = "Your resident can propose ideas to this town here, which others can back with stamps, and the ones that get backed get built.";
// WORLD/marks/the-town/the-think-tank/tank-post/mark.md — slot/value verbatim
const TANK_POST_SLOT = "post";
const TANK_POST_VALUE = 'town do:"post" class:"idea"';
const GUILD_BODY = "The town asks your resident for things here — daily quests that pay stamps, and big asks like the funding pots your household can back with dollars.";

// ── the fixture · the hydration's real DDL ──────────────────────────────────
function storeWith(marks, predicates = []) {
  const dir = mkdtempSync(join(tmpdir(), "civic-asks-"));
  const path = join(dir, "world.db");
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
           CREATE TABLE nodes (id TEXT PRIMARY KEY, kind TEXT, subkind TEXT, tier TEXT, by TEXT,
                               at_x REAL, at_y REAL, extent_w REAL, extent_h REAL, props TEXT);
           CREATE TABLE edges (seq INTEGER PRIMARY KEY AUTOINCREMENT,
                               src TEXT, dst TEXT, type TEXT, props TEXT, born_at TEXT)`);
  db.prepare("INSERT INTO meta (key, value) VALUES ('hydration_status', ?)").run("OK");
  const node = db.prepare("INSERT INTO nodes (id, kind, subkind, tier, by, props) VALUES (?, ?, ?, 'constitution', 'the-town', ?)");
  for (const m of marks) node.run(m.id, "mark", null, JSON.stringify({ body: m.body }));
  const edge = db.prepare("INSERT INTO edges (src, dst, type) VALUES (?, ?, 'describes')");
  for (const p of predicates) {
    node.run(p.id, "mark", "predicated", JSON.stringify({ slot: p.slot, value: p.value, body: p.body ?? null }));
    edge.run(p.parent, p.id);
  }
  db.close();
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const ALL_FIVE = CIVIC_QUARTER.map((l) => ({ id: l.place, body: `plaque for ${l.lane}` }));

// ── THE SHAPE ───────────────────────────────────────────────────────────────

test("the answer wears the world's shape — read / of / five rows / reading_law", () => {
  const { path, cleanup } = storeWith(ALL_FIVE);
  try {
    const a = civicQuarter({ worldDb: path });
    assert.equal(a.read, "asks");
    assert.equal(a.of, "the-civic-quarter");
    assert.equal(a.quarter.length, 5, "five buildings, five rows — a caller who has to ask five times has to know five names");
    assert.equal(a.reading_law, CIVIC_READING_LAW);
    for (const row of a.quarter)
      assert.deepEqual(Object.keys(row).sort(), ["body", "lane", "name", "place", "predicates", "standing"]);
  } finally { cleanup(); }
});

test("the five lanes are the asks matrix's five, in its own order, by mark id", () => {
  assert.deepEqual(CIVIC_QUARTER.map((l) => l.lane), ["quests", "ideas", "bounties", "listings", "votes"]);
  assert.deepEqual(CIVIC_QUARTER.map((l) => l.place), [
    "the-town/the-quest-guild", "the-town/the-think-tank", "the-town/the-bounty-board",
    "the-town/the-marketplace", "the-town/the-ballot-house",
  ]);
  // BY ID, NEVER BY PATH — two of the five are filed under
  // let-there-be-light/the-town-centre/… (the ballot house inside the Keeping
  // Works), so a reader that walked directories would find three and call two
  // absent.
  for (const l of CIVIC_QUARTER) assert.match(l.place, /^the-town\//, `${l.lane}: the id is the town's, wherever the file sits`);
});

// ── VERBATIM ────────────────────────────────────────────────────────────────

test("the body is the record's bytes — byte for byte, and this door holds no copy of one", () => {
  const { path, cleanup } = storeWith([
    { id: "the-town/the-think-tank", body: TANK_BODY },
    { id: "the-town/the-quest-guild", body: GUILD_BODY },
  ]);
  try {
    const a = civicQuarter({ worldDb: path });
    assert.equal(a.quarter.find((r) => r.lane === "ideas").body, TANK_BODY);
    assert.equal(a.quarter.find((r) => r.lane === "quests").body, GUILD_BODY);
  } finally { cleanup(); }
});

test("THE PAGE HOLDS NO TRANSCRIPTION — no plaque sentence is written into the office", async () => {
  // The 2026-08-31 lesson, in its own words: "a quote typed into a page is a
  // copy nothing keeps honest", and "the fix for a stale copy is never a
  // fresher copy — it is to delete the copy and read the record". A falsifier
  // that asserted "the read returns the right sentence" would go green on a
  // fresh transcription and rot on the same clock, so this one asserts the
  // ABSENCE of a transcription instead.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/world-classes.mjs", import.meta.url), "utf8");
  for (const [what, body] of [["the Think Tank", TANK_BODY], ["the Quest Guild", GUILD_BODY]]) {
    // a distinctive clause, long enough that a coincidence is not plausible
    const clause = body.slice(0, 48);
    assert.equal(src.includes(clause), false,
      `${what}'s plaque is transcribed into world-classes.mjs — delete the copy and read the record`);
  }
});

// ── PREDICATES ──────────────────────────────────────────────────────────────

test("predicates fold off the describes edge, slot -> value, from the record", () => {
  const { path, cleanup } = storeWith(ALL_FIVE, [
    { id: "the-town/tank-post", parent: "the-town/the-think-tank", slot: TANK_POST_SLOT, value: TANK_POST_VALUE },
    { id: "the-town/tank-back", parent: "the-town/the-think-tank", slot: "back", value: 'town do:"stake"' },
  ]);
  try {
    const tank = civicQuarter({ worldDb: path }).quarter.find((r) => r.lane === "ideas");
    assert.deepEqual(tank.predicates, { back: 'town do:"stake"', post: TANK_POST_VALUE });
    // THE VERB THAT OPENS THE LANE, which is the whole point of the round:
    // residents will never do something they don't know they can do.
    assert.equal(tank.predicates.post, 'town do:"post" class:"idea"');
    // and a plaque with no predicated children is {}, never undefined
    assert.deepEqual(civicQuarter({ worldDb: path }).quarter.find((r) => r.lane === "votes").predicates, {});
  } finally { cleanup(); }
});

test("a predicate is folded by SUBKIND — the store's key, not the file's frontmatter word", () => {
  // The trap this test exists for: mark.md says `kind: predicated`, the store
  // writes kind='mark' / subkind='predicated'. A child filed with the wrong
  // discriminator must not be folded, or the reader is matching on nothing.
  const { path, cleanup } = storeWith(ALL_FIVE);
  try {
    const db = new DatabaseSync(path);
    db.prepare("INSERT INTO nodes (id, kind, subkind, tier, by, props) VALUES ('the-town/not-a-predicate','mark','sited','constitution','the-town',?)")
      .run(JSON.stringify({ slot: "ghost", value: "should not be folded" }));
    db.prepare("INSERT INTO edges (src, dst, type) VALUES ('the-town/the-think-tank','the-town/not-a-predicate','describes')").run();
    db.close();
    const tank = civicQuarter({ worldDb: path }).quarter.find((r) => r.lane === "ideas");
    assert.equal(tank.predicates.ghost, undefined,
      "a sited child on a describes edge is not a predicate — the fold reads subkind");
  } finally { cleanup(); }
});

test("EVERY predicate the record carries is folded — including the ballot house's fn: shelf", () => {
  // The office reads the record and does not curate it. Filtering `fn:` by
  // prefix would be exactly the hardcode world-classes.mjs opens by refusing:
  // "a door implementation is correct precisely insofar as it READS the class
  // tree, and wrong wherever it hardcodes." If the function shelf should not
  // stand beside the civic predicates, that is a question for the record.
  const { path, cleanup } = storeWith(ALL_FIVE, [
    { id: "the-town/ballot-vote", parent: "the-town/the-ballot-house", slot: "vote", value: 'household do:"stake-vote"' },
    { id: "the-town/the-tally", parent: "the-town/the-ballot-house", slot: "fn:tally", value: "tools/ballot.mjs::tally" },
  ]);
  try {
    const ballot = civicQuarter({ worldDb: path }).quarter.find((r) => r.lane === "votes");
    assert.deepEqual(Object.keys(ballot.predicates).sort(), ["fn:tally", "vote"]);
  } finally { cleanup(); }
});

// ── STANDING, AND THE FLOOR ─────────────────────────────────────────────────

test("a plaque absent from the store reads standing: false with a NULL body — never an invented sentence", () => {
  const { path, cleanup } = storeWith(ALL_FIVE.filter((m) => m.id !== "the-town/the-marketplace"));
  try {
    const a = civicQuarter({ worldDb: path });
    const market = a.quarter.find((r) => r.lane === "listings");
    assert.equal(market.standing, false);
    assert.equal(market.body, null);
    assert.deepEqual(market.predicates, {});
    // …and the four the record DOES carry are unaffected: one absent plaque is
    // not an unreadable quarter.
    assert.equal(a.quarter.filter((r) => r.standing).length, 4);
    assert.equal(a.source, "store", "the store answered — the absence is the record's, not the reader's");
  } finally { cleanup(); }
});

test("the store unreadable is DISCLOSED, and is not the same answer as an empty quarter", () => {
  const a = civicQuarter({ worldDb: "Z:/nowhere/never-a-store.db" });
  assert.equal(a.source, "floor");
  assert.match(a.disclosed, /no world store/);
  assert.equal(a.quarter.length, 5, "the five lanes are still named — the office knows the quarter exists");
  for (const r of a.quarter) { assert.equal(r.standing, false); assert.equal(r.body, null); }
  // "An answer given without its inputs must never wear the grammar of an
  // answer that had them" — the-town/the-disclosure, slot `disclosure`.
  const good = civicQuarter({ worldDb: storeWithCleanup() });
  assert.notEqual(a.source, good.source);
  assert.equal(good.disclosed, undefined, "a good read discloses nothing, and that is how the two are told apart");
});
let _tmpStore = null;
function storeWithCleanup() {
  if (!_tmpStore) _tmpStore = storeWith(ALL_FIVE);
  return _tmpStore.path;
}
test.after(() => { _tmpStore?.cleanup(); });

// ── THE DOOR ────────────────────────────────────────────────────────────────

test("`asks` is a sibling of quests / bounties / ideas on the town menu", async () => {
  assert.ok(TOWN_READABLE.includes("asks"), "asks is on the menu");
  assert.equal(TOWN_READS.asks.tool, "read_asks");
  for (const lane of ["quests", "bounties", "ideas", "votes"])
    assert.ok(TOWN_READABLE.includes(lane), `${lane} is its sibling on the same menu`);
  // the apex names the flat verb and hands the call back — it reimplements
  // nothing, which is what keeps a delisted verb honest.
  const calls = [];
  // `schemas` rides now (2026-09-11): the read branch validates `args:` against
  // the flat tool's own field list, so a caller that hands the apex no schema
  // map is answered as the WIRING defect it is rather than silently validating
  // nothing. Both live call sites pass it; this probe must too.
  const { TOOLS } = await import("../src/mcp.mjs");
  const out = await townApex({ read: "asks" }, null, {
    schemas: Object.fromEntries(TOOLS.map((t) => [t.name, t.inputSchema?.properties ?? {}])),
    call: async (tool, args) => { calls.push({ tool, args }); return { ok: tool }; },
  });
  assert.deepEqual(calls.map((c) => c.tool), ["read_asks"]);
  assert.deepEqual(out, { ok: "read_asks" }, "…and returns what the flat verb returned, untouched");
});

test("the read: enum learned the name — a door that advertised asks and refused it would be lying", async () => {
  const { TOWN_TOOL, TOWN_DISPATCHABLE } = await import("../src/town-apex.mjs");
  assert.deepEqual(TOWN_TOOL.inputSchema.properties.read.enum, [...TOWN_READABLE, ...TOWN_DISPATCHABLE]);
  assert.ok(TOWN_TOOL.inputSchema.properties.read.enum.includes("asks"));
});

test("the flat verb exists, is DELISTED, and its description is the door's own words", async () => {
  const mcp = await import("../src/mcp.mjs");
  const def = (mcp.TOOLS ?? mcp.tools ?? []).find?.((t) => t.name === "read_asks");
  // TOOLS may be composed behind a function in this build; fall back to source.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/mcp.mjs", import.meta.url), "utf8");
  assert.ok(def || src.includes('{ name: "read_asks"'), "read_asks has a tool definition");
  assert.match(src, /"read_asks",/, "…and rides the delisted list — born behind the apex, listed nowhere flat");
  assert.match(src, /case "read_asks": return civicQuarter\(\);/, "…and dispatches to the one reader");
});

// ── PART C · THE DOORSTEP POINTER ───────────────────────────────────────────

test("the doorstep carries a POINTER to the quarter, not the plaques", async () => {
  const { fixtureDb } = await import("./fixture.mjs");
  const { doorstepBundle } = await import("../src/doorstep-bundle.mjs");
  const dir = mkdtempSync(join(tmpdir(), "civic-doorstep-"));
  try {
    const p = join(dir, "fixture.db");
    fixtureDb(p).close();
    const db = new DatabaseSync(p, { readOnly: true });
    const meta = { as_of: "fixturesha000000000000000000000000000000" };
    const base = { db, key: null, meta, asOf: meta.as_of, canWrite: false, clone: null, pen: null, odb: null, dbPath: null };
    const d = await doorstepBundle("wright", base);

    assert.equal(d.civic.read, 'town read:"asks"');
    assert.equal(d.civic.note,
      "the Think Tank (ideas) and the Bounty Board (bounties): what your resident can put on each, and what only the town can — the five plaques, verbatim");

    // THE LANES ARE NAMED (2026-09-21, POS-170, postmark#3011). Kogane spent six
    // days in town without seeing either lane, because the line above named the
    // quarter's READ and neither lane's NAME. The equality pins the sentence;
    // these pin the RULING, so a future rewording that keeps the byte count and
    // drops a name still reds. And the parentheticals are read ARGS, so they are
    // asserted against `TOWN_READS` rather than typed twice — a name in this note
    // that the door would refuse is the pointer the issue was filed about.
    for (const [lane, arg] of [["the Think Tank", "ideas"], ["the Bounty Board", "bounties"]]) {
      assert.ok(d.civic.note.includes(lane), `the civic line does not name ${lane} — the whole of postmark#3011`);
      assert.ok(d.civic.note.includes(`(${arg})`), `the civic line names ${lane} without its read arg`);
      assert.ok(Object.hasOwn(TOWN_READS, arg), `the civic line points at town read:"${arg}", which this door does not serve`);
    }
    // …and `asks` is the QUARTER, not the board. #3011's shape line glossed the
    // Bounty Board as `asks`; that gloss would have sent a resident to the five
    // plaques from inside the line written to stop exactly that.
    assert.equal(TOWN_READS.asks.tool, "read_asks");
    assert.equal(TOWN_READS.bounties.tool, "read_bounties");
    assert.equal(d.civic.note.includes("(asks)"), false,
      "the board's read is `bounties`; `asks` is the quarter this block already points at");

    // THE FOUNDER'S SENTENCE, and the thing it demands of this block:
    // "residents will never do something they don't know they can do."
    // The doorstep is where a resident learns what today offers, so the quarter
    // has to be NAMED here — a read they cannot discover is a read they do not
    // have.
    // ⚠ SEARCH THE SERIALISED FORM, not the source form. The first draft of
    // this line looked for `town read:"asks"` inside JSON.stringify(d) and went
    // red against a page that carried it perfectly well — JSON escapes the
    // quotes, so the needle matched nothing. An instrument that does not look
    // at what it claims to be looking at invents findings; the escape is taken
    // from JSON itself rather than typed.
    const needle = JSON.stringify('town read:"asks"').slice(1, -1);
    assert.ok(JSON.stringify(d).includes(needle),
      "the morning page names the quarter's read — residents will never do something they don't know they can do");

    // AND THE CEILING STILL HOLDS. Hal's foyer shrank the bare doorstep 63% two
    // days ago. Five plaque bodies are ~630 bytes; this pointer is a fraction of
    // that, and the assertion is that no BODY came with it.
    const bytes = JSON.stringify(d.civic).length;
    assert.ok(bytes < 200, `the civic block is a pointer, not a page (${bytes} bytes)`);
    assert.equal(JSON.stringify(d).includes("Your resident can propose ideas"), false,
      "a plaque body reached the morning page — the pointer exists so the 630 bytes stay one read away");

    // PUBLIC, deliberately: it says what ANY resident may do on the town's own
    // lanes, so it rides a stranger's read exactly as it rides your own.
    const own = await doorstepBundle("wright", { ...base, own: true });
    assert.deepEqual(own.civic, d.civic, "the town's own signage is not withheld from a stranger");
    db.close();
  } finally {
    // The fixture db keeps an open handle on Windows past the readOnly close in
    // some builds; a temp directory that outlives the run is not a failed law.
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* leave it to the OS */ }
  }
});

// ── PART A's OFFICE HALF · the fact the office can settle ────────────────────
//
// The town's board is pure and its uncounted rows come back `complete: null` —
// "this surface did not look". The office CAN look, for `first-idea`, and the
// registry's own derivation sentence names exactly what to look at:
//
//   "the household's first class:idea mark standing on the-town/the-think-tank"

test("the office settles first-idea from the TANK, per household — the mark, not the ledger line", async () => {
  const { injectedComplete } = await import("../src/queries.mjs");
  const idea = (by, slug) => ({ id: `${by}/${slug}`, by, slug });
  const { path, cleanup } = tankWith([idea("wright", "a-newcomers-first-hour")]);
  try {
    assert.deepEqual(injectedComplete("wright", { worldDb: path }), { "first-idea": true },
      "the household published an idea — that is the doing the row is about");
    assert.deepEqual(injectedComplete("alden", { worldDb: path }), { "first-idea": false },
      "…and a household that has not is told so, which is what makes the true answer worth anything");
  } finally { cleanup(); }
});

test("ONCE PER HOUSEHOLD: a HOUSEMATE's idea settles your row, and a stranger's does not", async () => {
  // ⚠ THIS TEST EXISTS BECAUSE A MUTATION FOUND ITS ABSENCE. Replacing the
  // whole household lookup with `[handle]` left the suite green: every other
  // falsifier here runs where householdOf resolves to null (a worktree with no
  // town clone), so the branch was never reached. The registry's own words are
  // the law it was missing — first-idea is "once per household, ever".
  const { injectedComplete } = await import("../src/queries.mjs");
  const { path, cleanup } = tankWith([{ id: "rei/the-quay-at-dusk", by: "rei" }]);
  try {
    assert.deepEqual(injectedComplete("wright", { worldDb: path, house: ["wright", "rei"] }),
      { "first-idea": true }, "rei published; wright shares her roof, so the household's row is settled");
    assert.deepEqual(injectedComplete("wright", { worldDb: path, house: ["wright"] }),
      { "first-idea": false }, "…and alone under his own roof it is not — the two answers differ, which is the whole point");
  } finally { cleanup(); }
});

test("the store unreadable settles NOTHING — a hydration blip must not un-earn a paying row", async () => {
  const { injectedComplete } = await import("../src/queries.mjs");
  assert.equal(injectedComplete("wright", { worldDb: "Z:/nowhere/never-a-store.db" }), null,
    "not injected, so the row stays null: 'this surface did not look' is not 'you have not done it'");
  // The direction matters. A floor read that answered `false` would tell a
  // household that has published an idea to go publish one — and that row PAYS.
  const { path, cleanup } = tankWith([{ id: "wright/an-idea", by: "wright" }]);
  try {
    assert.notEqual(injectedComplete("wright", { worldDb: path }), null,
      "…and a store that DOES answer settles it — otherwise this test could not tell the two apart");
  } finally { cleanup(); }
});

// A store holding the idea class's DECLARATION, a Think Tank, and the given
// ideas — each edged `instance-of` to the declaration the way world-hydrate.mjs
// § THE INSTANCE-OF RAILS edges one, and placed by `standing_at`:
//
//   { id, by }                    stands in the Tank      (contains edge)
//   { id, by, ground }            stands on that ground   (contains edge)
//   { id, by, about }             is a predicate OF that mark (describes edge)
//   { id, by, standing_at: null } folded nowhere yet      (no placement edge)
//
// ⚠ THE DECLARATION IS THE PART A FIXTURE GETS WRONG. Until 2026-09-01 this
// helper wrote a `contains` edge and nothing else, which was the whole shape
// `ideasTank` then read. The reader now joins `instance-of` and resolves the
// class node through CLASS_ROSTER_GATE_SQL — by: the-town, tier: constitution,
// props.class, IN THE KEEPING WORKS — so a fixture that skips `in_works`
// produces a store with no declaration, an empty tank, and a green suite about
// nothing. Verified against a store hydrated from world main fdca66cc before it
// was written; `the-town/idea` is the live id and is NOT written into the
// reader, which finds it by that gate.
//
// The declaration also carries `class: "idea"` itself (a class mark declares
// the class it IS) and deliberately gets NO instance-of edge to itself — that
// is the type/instance seam `markClass` names, and it is what keeps the
// constitution mark out of its own lane read.
function tankWith(ideas) {
  const dir = mkdtempSync(join(tmpdir(), "civic-tank-"));
  const path = join(dir, "world.db");
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
           CREATE TABLE nodes (id TEXT PRIMARY KEY, kind TEXT, subkind TEXT, tier TEXT, by TEXT,
                               at_x REAL, at_y REAL, extent_w REAL, extent_h REAL, props TEXT);
           CREATE TABLE edges (seq INTEGER PRIMARY KEY AUTOINCREMENT,
                               src TEXT, dst TEXT, type TEXT, props TEXT, born_at TEXT)`);
  db.prepare("INSERT INTO meta (key, value) VALUES ('hydration_status','OK')").run();
  db.prepare(`INSERT INTO nodes (id, kind, subkind, tier, by, props)
              VALUES ('the-town/idea','mark','class','constitution','the-town',
                      '{"class":"idea","in_works":1,"body":"the idea class law"}')`).run();
  db.prepare("INSERT INTO nodes (id, kind, tier, by, props) VALUES ('the-town/the-think-tank','mark','constitution','the-town','{}')").run();
  const n = db.prepare("INSERT INTO nodes (id, kind, subkind, tier, by, props) VALUES (?, 'mark', ?, 'market', ?, ?)");
  const inst = db.prepare("INSERT INTO edges (src, dst, type) VALUES (?, 'the-town/idea', 'instance-of')");
  const place = db.prepare("INSERT INTO edges (src, dst, type) VALUES (?, ?, ?)");
  for (const i of ideas) {
    const predicated = i.about !== undefined;
    n.run(i.id, predicated ? "predicated" : "sited", i.by,
      JSON.stringify({ class: "idea", body: "an idea", date: "2026-09-01" }));
    inst.run(i.id);
    if (predicated) place.run(i.about, i.id, "describes");
    else if (i.standing_at !== null) place.run(i.ground ?? "the-town/the-think-tank", i.id, "contains");
  }
  db.close();
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
