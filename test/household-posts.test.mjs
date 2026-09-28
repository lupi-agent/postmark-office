// household-posts.test.mjs — a household's posts, one read, two readers (POS-293).
//
//   node --test test/household-posts.test.mjs
//
// The brief's seven falsifiers, in its order:
//
//   1. a household's own event appears under `put_up`, with the state from the clock;
//   2. another household's event that one of our residents RSVPed appears under
//      `taking_part`, with `role: participant`;
//   3. an idea our resident staked on appears under `taking_part`, with `ours`
//      equal to the stake;
//   4. an event ended 8 days ago is absent;
//   5. an RSVP's harness and budget never appear anywhere in the answer;
//   6. the doorstep segment deep-equals the named read at the same args;
//   7. the cap reports the true total.
//
// ⚑ THE EVENTS ARE A JS STUB OF THE STORE (`acts-pen-stub.mjs`), as in
// events.test.mjs: it proves which rows this read asks for and what it makes of
// them, nothing about Postgres. The stub's `responses` rows carry their whole
// `fields` (the harness, the budget, a webhook address) on purpose: a read that
// passed a row through would carry them out, and falsifier 5 would see it.
//
// THE IDEAS are a world store built the way idea-anywhere.test.mjs builds one,
// and their backing is the TOWN ENGINE'S OWN CODE (tools/world-stake.mjs and
// tools/stamp-mint.mjs, copied from the pinned town clone) folding a ledger
// written here — so `ours` and `stake` are the engine's numbers, not a fixture's.
//
// THE FLIPS (NOTES.md in the lane folder holds their red lines):
//   · taking_part — drop `|| ours.has(p.id)` from eventRows' filter and 2 goes red;
//   · private fields — widen the responses SELECT to `post, handle, state, fields`
//     and 5 goes red on the query leg.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { installActsPen, uninstallActsPen, RECORD_ON } from "./acts-pen-stub.mjs";
import { OFFICE_ROOT } from "./fixture-paths.mjs";

const REAL_TOWN = process.env.TOWN_CLONE ?? join(OFFICE_ROOT, "town-clone");
const haveEngine = existsSync(join(REAL_TOWN, "tools", "world-stake.mjs")) && existsSync(join(REAL_TOWN, "tools", "stamp-mint.mjs"));

const DIR = mkdtempSync(join(tmpdir(), "pm-household-posts-"));
after(() => { try { rmSync(DIR, { recursive: true, force: true, maxRetries: 5 }); } catch { /* Windows keeps a handle */ } });

const H = 3_600_000;
const D = 24 * H;
const NOW = Date.parse("2026-09-28T12:00:00.000Z");
const iso = (t) => new Date(t).toISOString();

// ── the town the ideas are backed in: the engine's code, our ledger ────────
const TOWN = join(DIR, "town");
mkdirSync(join(TOWN, "tools"), { recursive: true });
mkdirSync(join(TOWN, "WHITE_PAGES"), { recursive: true });
if (haveEngine) for (const f of ["world-stake.mjs", "stamp-mint.mjs"]) copyFileSync(join(REAL_TOWN, "tools", f), join(TOWN, "tools", f));
writeFileSync(join(TOWN, "WHITE_PAGES", "stamp-ledger.md"), [
  "# the stamp ledger", "",
  "- 2026-09-20 · mari → stake:world-mark/kai/observation-state · 5 · via: api",
  "- 2026-09-21 · zed → stake:world-mark/kai/observation-state · 3 · via: api",
  "- 2026-09-22 · limen → stake:world-mark/rei/events-as-objects · 2 · via: api",
  "- 2026-09-23 · rei → stake:world-mark/rei/events-as-objects · 1 · via: api",
  "",
].join("\n"));

// ── the world store: three ideas, by the hydration's own shapes ─────────────
const WORLD_DB = join(DIR, "world.db");
{
  const db = new DatabaseSync(WORLD_DB);
  db.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
           CREATE TABLE nodes (id TEXT PRIMARY KEY, kind TEXT, subkind TEXT, tier TEXT, by TEXT,
                               at_x REAL, at_y REAL, extent_w REAL, extent_h REAL, props TEXT);
           CREATE TABLE edges (seq INTEGER PRIMARY KEY AUTOINCREMENT, src TEXT, dst TEXT, type TEXT, props TEXT, born_at TEXT)`);
  db.prepare("INSERT INTO meta (key, value) VALUES ('hydration_status','OK')").run();
  db.prepare(`INSERT INTO nodes (id, kind, subkind, tier, by, props) VALUES ('the-town/idea', 'mark', 'class', 'constitution', 'the-town', ?)`)
    .run(JSON.stringify({ class: "idea", in_works: 1, body: "an idea is a resident's ask of the town" }));
  db.prepare("INSERT INTO nodes (id, kind, tier, by, props) VALUES ('the-town/the-think-tank', 'mark', 'constitution', 'the-town', '{}')").run();
  const idea = db.prepare("INSERT INTO nodes (id, kind, subkind, tier, by, props) VALUES (?, 'mark', 'sited', 'market', ?, ?)");
  const edge = db.prepare("INSERT INTO edges (src, dst, type) VALUES (?, ?, ?)");
  for (const [id, by, body, date] of [
    ["rei/events-as-objects", "rei", "Events should be town objects.", "2026-09-05"],
    ["kai/observation-state", "kai", "Make observation state first-class.", "2026-09-02"],
    ["neth/held-letters", "neth", "Let a resident hold the letters it is answering.", "2026-09-14"],
  ]) {
    idea.run(id, by, JSON.stringify({ class: "idea", body, date }));
    edge.run(id, "the-town/idea", "instance-of");
    edge.run("the-town/the-think-tank", id, "contains");
  }
  db.close();
}

process.env.TOWN_CLONE = TOWN;
process.env.WORLD_STORE_DB = WORLD_DB;
const { householdPosts, POSTS_CAP } = await import("../src/household-posts.mjs");

// ── the registry: Starforge holds wright, rei and mari ──────────────────────
const REGISTRY = { registry: { registry: { households: {
  starforge: { residents: ["wright", "rei", "mari"] },
  "shard-house": { residents: ["kogane"] },
} }, pins: {} } };

// ── the events, in the store's shape ────────────────────────────────────────
const posts = new Map();
const responses = [];
const acts = [];
let nextAct = 1;
const event = (id, author, household, starts, ends, state = "announced") => {
  posts.set(id, { id, class: "event", title: `the ${id.split("/")[1]}`, body: "come", author, household,
    place_mark: null, place_x: 0, place_y: 0, starts: iso(starts), ends: iso(ends), state,
    fields: { doors_open: iso(starts) }, revised: 0, posted_act: nextAct, last_act: nextAct });
  acts.push({ id: nextAct++, class: "event", action: "host", object: id, at: iso(starts - 3 * D) });
};
const rsvp = (post, handle, household, at) => {
  responses.push({ post, handle, household, kind: "rsvp", state: "standing",
    fields: { harness: "webhook", budget: 6, fell_back: null, address: "https://secret.example/hook" }, act: nextAct });
  acts.push({ id: nextAct++, class: "event", action: "rsvp", object: post, at: iso(at) });
};

event("wright/office-hours", "wright", "hh:starforge", NOW + 2 * D, NOW + 2 * D + 2 * H);
event("kogane/tea", "kogane", "hh:shard-house", NOW - H, NOW + H);
event("rei/old-party", "rei", "hh:starforge", NOW - 9 * D, NOW - 8 * D);
event("rei/called-off", "rei", "hh:starforge", NOW + D, NOW + D + H, "cancelled");
event("zed/elsewhere", "zed", "solo:zed", NOW + D, NOW + D + H);
// for the order: one that starts sooner than office hours but acted longer ago,
// and one that ended within the week
event("mari/tomorrow", "mari", "hh:starforge", NOW + D, NOW + D + H);
event("rei/last-week", "rei", "hh:starforge", NOW - 3 * D, NOW - 2 * D);
rsvp("kogane/tea", "mari", "hh:starforge", NOW - 2 * H);
rsvp("wright/office-hours", "kogane", "hh:shard-house", NOW - D);
rsvp("zed/elsewhere", "zed", "solo:zed", NOW - D);

const ALSO = [
  [/^SELECT id, class, title, author, household, starts, ends, fields, state, last_act FROM posts WHERE class = \$1 AND ends > \$2 ORDER BY starts, id$/i, (q, p) => {
    const rows = [...posts.values()].filter((r) => r.class === p[0] && Date.parse(r.ends) > Date.parse(p[1]))
      .sort((a, b) => Date.parse(a.starts) - Date.parse(b.starts) || a.id.localeCompare(b.id)).map((r) => ({ ...r, fields: { ...r.fields } }));
    return { rows, rowCount: rows.length };
  }],
  // WHOLE ROWS, whatever the SELECT named: the read must pick its columns itself
  [/FROM responses WHERE post = ANY\(\$1\) ORDER BY post, handle$/i, (q, p) => {
    const rows = responses.filter((r) => p[0].includes(r.post)).map((r) => ({ ...r, fields: { ...r.fields } }));
    return { rows, rowCount: rows.length };
  }],
];

// The acts go in through the pen's own INSERT, so its built-in acts reader
// (which honours class, object = ANY and ORDER BY id) answers them back.
async function penWith() {
  const p = installActsPen({ also: ALSO });
  for (const a of acts)
    await p.query("INSERT INTO acts (at, actor, action, object, class, payload) VALUES ($1, $2, $3, $4, $5, $6)",
      [a.at, "someone", a.action, a.object, a.class, "{}"]);
  return p;
}
let pen;
before(async () => { Object.assign(process.env, RECORD_ON); pen = await penWith(); });
after(() => { uninstallActsPen(); delete process.env.WORLD2_PG; delete process.env.WORLD2_PG_URL; });

const read = (handle, now = NOW) => householdPosts(handle, { now, townClone: TOWN, worldDb: WORLD_DB, readers: REGISTRY });
const row = (list, id) => list.rows.find((r) => r.id === id) ?? null;

test("1 · the house's own event is put up, and its state is the clock's: announced, then live, then ended", async () => {
  const a = await read("wright");
  assert.deepEqual(a.unavailable, undefined, `a class went unread: ${a.unavailable}`);
  assert.equal(a.household, "hh:starforge");
  const own = row(a.put_up, "wright/office-hours");
  assert.ok(own, "the house's own event is not under put_up");
  assert.deepEqual(Object.keys(own).sort(), ["author", "class", "household", "id", "latest", "ours", "responses", "role", "stake", "state", "title"],
    "a row carries the general fields and nothing else");
  assert.deepEqual([own.class, own.role, own.state, own.responses], ["event", "author", "announced", 1]);
  assert.deepEqual(own.latest, { act: "rsvp", at: iso(NOW - D) }, "someone else's RSVP is the author's latest outcome");
  assert.equal((await read("wright", NOW + 2 * D + H)).put_up.rows.find((r) => r.id === "wright/office-hours").state, "live");
  assert.equal((await read("wright", NOW + 2 * D + 3 * H)).put_up.rows.find((r) => r.id === "wright/office-hours").state, "ended");
  assert.equal(row(a.put_up, "rei/called-off").state, "cancelled", "the one state an act stores");
  assert.deepEqual(row(a.put_up, "rei/called-off").latest, { act: "post", at: iso(NOW + D - 3 * D) }, "a legacy host act reads in the post's word");
  // any resident's handle answers for the house
  assert.deepEqual(await read("mari"), a);
});

test("2 · another house's event our resident RSVPed is taken part in, as a participant", async () => {
  const a = await read("wright");
  const tea = row(a.taking_part, "kogane/tea");
  assert.ok(tea, "the event mari RSVPed to is not under taking_part");
  assert.deepEqual([tea.role, tea.author, tea.household, tea.state, tea.responses], ["participant", "kogane", "hh:shard-house", "live", 1]);
  assert.equal(row(a.put_up, "kogane/tea"), null);
  assert.equal(row(a.taking_part, "zed/elsewhere"), null, "an event nobody in the house answered is not the house's");
  assert.equal(row(a.put_up, "zed/elsewhere"), null);
});

test("3 · an idea our resident backs is taken part in, with ours equal to the stake", { skip: !haveEngine && `needs the town engine at ${REAL_TOWN}` }, async () => {
  const a = await read("wright");
  const kai = row(a.taking_part, "kai/observation-state");
  assert.ok(kai, "the idea mari staked on is not under taking_part");
  assert.deepEqual([kai.class, kai.role, kai.state, kai.ours, kai.stake, kai.responses], ["idea", "participant", "posted", 5, 8, 2]);
  assert.equal(kai.title, "Make observation state first-class.", "an idea's title is its body");
  assert.deepEqual(kai.latest, { act: "stake", at: "2026-09-21" });
  const reis = row(a.put_up, "rei/events-as-objects");
  assert.deepEqual([reis.role, reis.stake, reis.ours, reis.household], ["author", 3, 1, "hh:starforge"]);
  assert.equal(row(a.taking_part, "neth/held-letters"), null, "an idea nobody in the house backs is not the house's");
  // and from the other side: Limen backs Rei's idea, and it is Limen's to take part in
  const limen = await read("limen");
  assert.deepEqual(limen.residents, ["limen"]);
  assert.equal(row(limen.taking_part, "rei/events-as-objects").ours, 2);
});

test("4 · an event that ended eight days ago is gone; one that ended within the week stays", async () => {
  const a = await read("wright");
  assert.equal([...a.put_up.rows, ...a.taking_part.rows].some((r) => r.id === "rei/old-party"), false);
  const sixDaysOn = await read("wright", NOW + 2 * D + 2 * H + 6 * D);
  assert.equal(row(sixDaysOn.put_up, "wright/office-hours")?.state, "ended", "ended within the week is still the house's");
});

test("5 · an RSVP's harness and budget never reach the answer, and the read never asks for them", async () => {
  const before = pen.asked().length;
  const text = JSON.stringify(await read("wright"));
  for (const word of ["harness", "budget", "fell_back", "secret.example", "webhook", "\"fields\""])
    assert.equal(text.includes(word), false, `"${word}" reached the answer`);
  const asked = pen.asked().slice(before).filter((q) => /responses|household_harnesses/i.test(q));
  assert.ok(asked.length > 0, "the read asked the store nothing about responses, so this leg proves nothing");
  for (const q of asked) {
    assert.doesNotMatch(q, /household_harnesses/i, "the read looked at the harness table");
    assert.match(q, /^SELECT post, handle, state FROM responses /i, `the read widened what it asks of responses: ${q}`);
  }
});

test("6 · the doorstep segment deep-equals household { read: \"posts\" } at the same args", async () => {
  const { fixtureDb } = await import("./fixture.mjs");
  const { doorstepBundle } = await import("../src/doorstep-bundle.mjs");
  const { householdApex } = await import("../src/household-apex.mjs");
  const dbPath = join(DIR, "fixture.db");
  fixtureDb(dbPath).close();
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const meta = { as_of: "fixturesha000000000000000000000000000000" };
    const ctx = { db, key: null, meta, asOf: meta.as_of, canWrite: false, clone: null, pen: null, odb: null, dbPath: null };
    const d = await doorstepBundle("wright", ctx);
    assert.ok(d.segments.includes("posts"), "the manifest does not name the segment");
    const { serves, args, ...segment } = d.posts;
    assert.equal(serves, "household.posts");
    assert.deepEqual(args, { handle: "wright" });
    assert.ok(segment.put_up.rows.some((r) => r.id === "wright/office-hours"), "the segment carries no rows, so equality would prove nothing");
    const asked = await householdApex({ read: "posts", ...args }, null, ctx);
    assert.deepEqual(segment, asked, "the segment drifted from the read its `serves` names");
  } finally {
    db.close();
  }
});

test("7 · each list is cut at the cap and says the true total", async () => {
  const extra = [];
  for (let i = 0; i < POSTS_CAP + 5; i++) {
    const id = `wright/gathering-${String(i).padStart(2, "0")}`;
    extra.push(id);
    event(id, "wright", "hh:starforge", NOW + 3 * D + i * H, NOW + 3 * D + i * H + 30 * 60_000);
  }
  try {
    const a = await read("wright");
    const all = [...posts.values()].filter((p) => ["wright", "rei", "mari"].includes(p.author) && Date.parse(p.ends) > NOW - 7 * D).length;
    const ideas = 1; // rei/events-as-objects
    assert.equal(a.put_up.total, all + ideas, "the total is every post the house put up in the window");
    assert.equal(a.put_up.shown, POSTS_CAP);
    assert.equal(a.put_up.rows.length, POSTS_CAP);
    assert.ok(a.put_up.total > a.put_up.shown, "the cut is said, not silent");
  } finally {
    for (const id of extra) posts.delete(id);
  }
});

test("8 · the order: open posts first (a span by its soonest start, then the rest by their newest act), then the ended and the called off, newest first", { skip: !haveEngine && `needs the town engine at ${REAL_TOWN}` }, async () => {
  const a = await read("wright");
  assert.deepEqual(a.put_up.rows.map((r) => r.id), [
    "mari/tomorrow",          // open, starts in a day (its last act is older than office hours')
    "wright/office-hours",    // open, starts in two
    "rei/events-as-objects",  // open, no span: by its newest act
    "rei/called-off",         // terminal: acted two days ago
    "rei/last-week",          // terminal: acted six days ago
  ]);
  assert.equal(a.put_up.rows.some((r) => Object.getOwnPropertySymbols(r).length), false, "the order's own key never rides the answer");
  // and the cut keeps the live: with more open posts than the cap, no terminal one is shown
  const extra = [];
  for (let i = 0; i < POSTS_CAP; i++) {
    const id = `wright/soon-${String(i).padStart(2, "0")}`;
    extra.push(id);
    event(id, "wright", "hh:starforge", NOW + 5 * D + i * H, NOW + 5 * D + i * H + H);
  }
  try {
    const cut = await read("wright");
    assert.equal(cut.put_up.rows.some((r) => ["ended", "cancelled"].includes(r.state)), false, "the cut kept a finished post over a live one");
  } finally {
    for (const id of extra) posts.delete(id);
  }
});

test("a class the office cannot read is named, and its rows are left out rather than read as none", async () => {
  uninstallActsPen();
  delete process.env.WORLD2_PG; delete process.env.WORLD2_PG_URL;
  try {
    const a = await householdPosts("wright", { now: NOW, townClone: TOWN, worldDb: join(DIR, "no-such-world.db"), readers: REGISTRY });
    assert.deepEqual(a.unavailable, [
      "the events could not be read from the office's record",
      "the Think Tank could not be read from the world record",
    ]);
    assert.deepEqual([a.put_up.total, a.taking_part.total], [0, 0]);
    const noRegistry = await householdPosts("wright", { now: NOW, townClone: TOWN, worldDb: WORLD_DB, clone: join(DIR, "no-such-town") });
    assert.match(noRegistry.unavailable[0], /registry could not be read/);
    assert.deepEqual(noRegistry.residents, ["wright"]);
  } finally {
    Object.assign(process.env, RECORD_ON);
    pen = await penWith();
  }
});
