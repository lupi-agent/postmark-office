// quest-posts.test.mjs — the town's quests become its posts (POS-294).
//
//   node --test test/quest-posts.test.mjs
//
// The gate, in its order:
//
//   1. every quest the board shows is a post row with the pen as author, put up
//      once by a posting act (the seeding) that names its hand;
//   2. only the town's hands (wright, keemin) post and close; everyone else is
//      refused, and nothing is written;
//   3. closing a quest is an act that names its hand, and a closed quest is
//      never put back up;
//   4. a quest takes no amend and no advance, refused by name;
//   5. the posts read answers class "quest" with the registry's terms, in the
//      registry's order, through the posts table's one reader;
//   6. the rebuild folds the quest acts back into exactly the rows the pen wrote.
//
// ⚑ THE STORE IS A JS STUB (`acts-pen-stub.mjs`), as in events.test.mjs: this
// proves which acts and rows the pen writes and what the read makes of them,
// nothing about Postgres. The registry is the town's own quest-registry.json,
// copied from the pinned town clone.
//
// THE FLIPS (NOTES.md in the lane folder holds their red lines):
//   · the hand — make judgeQuestHand accept any handle and 2 goes red;
//   · the author — write the act as the hand instead of the pen and 1 goes red.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { installActsPen, uninstallActsPen, RECORD_ON } from "./acts-pen-stub.mjs";
import { OFFICE_ROOT } from "./fixture-paths.mjs";

const REAL_TOWN = process.env.TOWN_CLONE ?? join(OFFICE_ROOT, "town-clone");
const DIR = mkdtempSync(join(tmpdir(), "pm-quest-posts-"));
const TOWN = join(DIR, "town");
mkdirSync(TOWN, { recursive: true });
copyFileSync(join(REAL_TOWN, "quest-registry.json"), join(TOWN, "quest-registry.json"));
after(() => { try { rmSync(DIR, { recursive: true, force: true, maxRetries: 5 }); } catch { /* Windows keeps a handle */ } });

process.env.TOWN_CLONE = TOWN;
Object.assign(process.env, RECORD_ON);
const { postAtTown, closeAtTown, amendAtTown, advanceAtTown, seedQuestPosts } = await import("../src/events-store.mjs");
const { postsAtOffice } = await import("../src/town-posts.mjs");
const { readQuestRegistry, questEntries, QUEST_HANDS } = await import("../src/quests.mjs");
const { compareRebuild, dryRun } = await import("../world2/tools/events-rebuild.mjs");

const REGISTRY = readQuestRegistry(TOWN);
const QUEST_IDS = questEntries(REGISTRY).map((q) => q.id);
// THE REAL CLOCK, NOT A PINNED DAY. The pen refuses a row stamped for a
// crossing older than the open window (src/events.mjs § refuse, the act-4171
// class), and the open window is read from the wall clock. A pinned 09-28 went
// red the day the window moved to 219: a calendar-pinned control decays.
const NOW = Date.now();

// The four cards the site's Quest Guild draws today (site src/lib/civic.mjs §
// QUEST_REGISTRY): the daily pair and the two milestones, by title.
const BOARD = ["Reach out", "Be reached", "Budding friendship", "A first idea"];

const WRIGHT = { household: "starforge", handles: new Set(["wright"]) };
const KEEMIN = { household: "darko", handles: new Set(["keemin"]) };
const ERRANT = { household: "errant", handles: new Set(["errant"]) };

// ── the posts table, in memory, answering exactly the queries asked ─────────
function questTables() {
  const posts = new Map();
  const PC = ["id", "class", "title", "body", "author", "household", "place_mark", "place_x", "place_y",
    "starts", "ends", "state", "fields", "revised", "posted_act", "last_act"];
  const asJson = (v) => (typeof v === "string" ? JSON.parse(v) : v);
  const copy = (r) => ({ ...r, fields: { ...r.fields } });
  const also = [
    [/^INSERT INTO posts/i, (q, p) => {
      if (posts.has(p[0])) throw new Error(`duplicate key value violates unique constraint "posts_pkey"`);
      const r = Object.fromEntries(PC.map((k, i) => [k, p[i]]));
      r.fields = asJson(r.fields);
      posts.set(p[0], r);
      return { rows: [], rowCount: 1 };
    }],
    [/^UPDATE posts SET/i, (q, p) => {
      const r = posts.get(p[0]);
      Object.assign(r, { title: p[1], body: p[2], place_mark: p[3], place_x: p[4], place_y: p[5],
        starts: p[6], ends: p[7], state: p[8], fields: asJson(p[9]), revised: p[10], last_act: p[11] });
      return { rows: [], rowCount: 1 };
    }],
    [/FROM posts WHERE id = \$1 AND class = \$2$/i, (q, p) => {
      const r = posts.get(p[0]);
      const hit = r && r.class === p[1];
      return { rows: hit ? [copy(r)] : [], rowCount: hit ? 1 : 0 };
    }],
    // the seeding's own look, and the posts table's one reader (household-posts.mjs § postRowsOf)
    [/^SELECT id, state FROM posts WHERE class = \$1 ORDER BY id$/i, (q, p) => {
      const rows = [...posts.values()].filter((r) => r.class === p[0]).sort((a, b) => a.id.localeCompare(b.id)).map((r) => ({ id: r.id, state: r.state }));
      return { rows, rowCount: rows.length };
    }],
    [/^SELECT id, class, title, author, household, starts, ends, fields, state, last_act FROM posts WHERE class = \$1 ORDER BY id$/i, (q, p) => {
      const rows = [...posts.values()].filter((r) => r.class === p[0]).sort((a, b) => a.id.localeCompare(b.id)).map(copy);
      return { rows, rowCount: rows.length };
    }],
    [/^SELECT post, handle, state FROM responses WHERE post = ANY\(\$1\) ORDER BY post, handle$/i, () => ({ rows: [], rowCount: 0 })],
    // the rebuild's reads
    [/^SELECT \* FROM posts WHERE class = \$1 ORDER BY id$/i, (q, p) => {
      const rows = [...posts.values()].filter((r) => r.class === p[0]).sort((a, b) => a.id.localeCompare(b.id)).map(copy);
      return { rows, rowCount: rows.length };
    }],
    [/^SELECT \* FROM responses WHERE kind = \$1 ORDER BY post, handle$/i, () => ({ rows: [], rowCount: 0 })],
  ];
  return { posts, also };
}

// The pen lives in the town's own household, as it does on prod (town
// WHITE_PAGES/postmark-pen/ADDRESS.md, "household: the town").
const HOUSES = [{ slug: "the-town", ord: 1, residents: ["postmark-pen"] }];

function setup() {
  const t = questTables();
  const pen = installActsPen({ households: HOUSES, also: t.also });
  return { ...t, pen };
}
test.afterEach(() => uninstallActsPen());

async function refusedWith(p, code, re) {
  await assert.rejects(p, (e) => { assert.equal(e.code, code, `${e.code} ${e.defect}`); if (re) assert.match(`${e.defect} ${e.hint}`, re); return true; });
}

// ── 1 ───────────────────────────────────────────────────────────────────────

test("1 · the seeding puts every registry quest up once, the pen as author and the act naming the hand; a second run posts nothing", async () => {
  const { pen, posts } = setup();
  assert.equal(QUEST_IDS.length, 11, "the registry's quests: 2 daily, 2 milestone, 7 one-time (the 2 pots are POS-291's)");

  const dry = await seedQuestPosts({ hand: "wright", registry: REGISTRY, now: NOW, dryRun: true });
  assert.deepEqual(dry.would_post, QUEST_IDS.map((id) => `postmark-pen/${id}`));
  assert.equal(pen.rows().length, 0, "a dry run wrote an act");

  const run = await seedQuestPosts({ hand: "wright", registry: REGISTRY, now: NOW });
  assert.equal(run.posted.length, 11);
  assert.equal(posts.size, 11);
  for (const act of pen.rows()) {
    assert.equal(act.class, "quest");
    assert.equal(act.action, "post");
    assert.equal(act.actor, "postmark-pen", "the act is the town pen's");
    assert.equal(act.household, "hh:the-town", "…in the town's own household");
    assert.equal(act.at_anchor, null, "a quest has no place: the act is anchorless");
    assert.equal(JSON.parse(act.payload).hand, "wright", "the act names the hand");
  }
  for (const id of QUEST_IDS) {
    const row = posts.get(`postmark-pen/${id}`);
    assert.ok(row, `${id} is not a post row`);
    assert.deepEqual([row.class, row.author, row.household, row.state], ["quest", "postmark-pen", "hh:the-town", "open"]);
    assert.deepEqual(row.fields, { quest: id }, "the row points at its registry entry and carries nothing else");
    assert.equal(row.starts, null); assert.equal(row.place_x, null);
  }
  // every card the board shows today is one of them
  const titles = new Map([...posts.values()].map((r) => [r.title, r]));
  for (const t of BOARD) assert.equal(titles.get(t)?.author, "postmark-pen", `the board's "${t}" is not a post by the pen`);
  assert.ok(![...posts.keys()].some((id) => /darko-fund|keeping-ec2/.test(id)), "a pot was posted");

  const again = await seedQuestPosts({ hand: "wright", registry: REGISTRY, now: NOW });
  assert.deepEqual([again.posted.length, again.already.length], [0, 11]);
  assert.equal(pen.rows().length, 11, "a second run wrote an act");
});

// ── 2 ───────────────────────────────────────────────────────────────────────

test("2 · only the town's hands post and close a quest: anyone else is refused and nothing is written", async () => {
  const { pen, posts } = setup();
  assert.deepEqual(QUEST_HANDS, ["wright", "keemin"]);
  await refusedWith(postAtTown({ class: "quest", quest: "correspond-send" }, ERRANT, { now: NOW, registry: REGISTRY }), 403, /only the town posts and closes/);
  await refusedWith(seedQuestPosts({ hand: "errant", registry: REGISTRY, now: NOW }), 403, /only the town/);
  assert.equal(pen.rows().length, 0);
  // the pen's own handle is not a hand: it is the author
  await refusedWith(postAtTown({ class: "quest", quest: "correspond-send" }, { handles: new Set(["postmark-pen"]) }, { now: NOW, registry: REGISTRY }), 403);

  const k = await postAtTown({ class: "quest", quest: "correspond-send" }, KEEMIN, { now: NOW, registry: REGISTRY });
  assert.equal(k.hand, "keemin");
  assert.equal(k.post.author, "postmark-pen");
  await postAtTown({ class: "quest", quest: "first-idea" }, WRIGHT, { now: NOW, registry: REGISTRY });
  await refusedWith(closeAtTown({ post: "postmark-pen/first-idea" }, ERRANT, { now: NOW }), 403, /only the town/);
  assert.equal(posts.get("postmark-pen/first-idea").state, "open");
  assert.equal(pen.rows().length, 2);
});

test("2b · a pot, an unknown quest, a repeat and a stray field are each refused by name", async () => {
  const { pen } = setup();
  await refusedWith(postAtTown({ class: "quest", quest: "keeping-ec2" }, WRIGHT, { now: NOW, registry: REGISTRY }), 422, /funding pot.*POS-291/);
  await refusedWith(postAtTown({ class: "quest", quest: "no-such" }, WRIGHT, { now: NOW, registry: REGISTRY }), 404, /no quest "no-such"/);
  await refusedWith(postAtTown({ class: "quest" }, WRIGHT, { now: NOW, registry: REGISTRY }), 422, /which quest/);
  await postAtTown({ class: "quest", quest: "correspond-send" }, WRIGHT, { now: NOW, registry: REGISTRY });
  await refusedWith(postAtTown({ class: "quest", quest: "correspond-send" }, WRIGHT, { now: NOW, registry: REGISTRY }), 409, /already posted/);
  assert.equal(pen.rows().length, 1);
  const { townPostEvent } = await import("../src/town-post.mjs");
  const stray = await townPostEvent({ class: "quest", quest: "first-idea", title: "mine" }, WRIGHT);
  assert.equal(stray.code, 422);
  assert.match(stray.defect, /a quest does not take: title/);
  assert.equal(pen.rows().length, 1);
});

// ── 3 ───────────────────────────────────────────────────────────────────────

test("3 · closing a quest is an act that names its hand; it stays, closed, and the seeding never puts it back", async () => {
  const { pen, posts } = setup();
  await seedQuestPosts({ hand: "wright", registry: REGISTRY, now: NOW });
  const c = await closeAtTown({ post: "postmark-pen/first-idea" }, KEEMIN, { now: NOW + 1000 });
  assert.equal(c.state, "closed");
  assert.equal(c.hand, "keemin");
  const act = pen.rows().at(-1);
  assert.deepEqual([act.class, act.action, act.actor, act.object], ["quest", "close", "postmark-pen", "postmark-pen/first-idea"]);
  assert.deepEqual(JSON.parse(act.payload), { post: "postmark-pen/first-idea", state: "closed", hand: "keemin" });
  const row = posts.get("postmark-pen/first-idea");
  assert.deepEqual([row.state, row.author, row.last_act], ["closed", "postmark-pen", act.id]);
  await refusedWith(closeAtTown({ post: "postmark-pen/first-idea", class: "quest" }, WRIGHT, { now: NOW }), 409, /already closed/);
  const again = await seedQuestPosts({ hand: "wright", registry: REGISTRY, now: NOW });
  assert.equal(again.posted.length, 0, "a closed quest was put back up");
});

// ── 4 ───────────────────────────────────────────────────────────────────────

test("4 · a quest takes no amend and no advance, refused by name, with or without its class", async () => {
  const { pen } = setup();
  await postAtTown({ class: "quest", quest: "correspond-send" }, WRIGHT, { now: NOW, registry: REGISTRY });
  const n = pen.rows().length;
  await refusedWith(amendAtTown({ post: "postmark-pen/correspond-send", title: "Reach further" }, WRIGHT, { now: NOW }), 422, /a quest is not amended.*registry/);
  await refusedWith(amendAtTown({ post: "postmark-pen/correspond-send", class: "quest", title: "x" }, WRIGHT, { now: NOW }), 422, /not amended/);
  await refusedWith(advanceAtTown({ post: "postmark-pen/correspond-send", to: "closed" }, WRIGHT), 422, /a quest has no advance/);
  await refusedWith(advanceAtTown({ post: "postmark-pen/correspond-send", class: "quest" }, WRIGHT), 422, /no advance/);
  assert.equal(pen.rows().length, n, "a refused verb wrote an act");
});

// ── 5 ───────────────────────────────────────────────────────────────────────

test("5 · the posts read answers class quest: the registry's order and terms, the class's finished states, no progress, from the one reader", async () => {
  const { pen } = setup();
  await seedQuestPosts({ hand: "wright", registry: REGISTRY, now: NOW });
  await closeAtTown({ post: "postmark-pen/welcome-to-postmark" }, WRIGHT, { now: NOW });
  const before = pen.asked().length;
  const r = await postsAtOffice({ class: "quest" }, { now: NOW, townClone: TOWN });
  const asked = pen.asked().slice(before).filter((q) => !/^(BEGIN|COMMIT|ROLLBACK)/.test(q) && !/set_config|statement_timeout|SET /i.test(q));
  assert.deepEqual(asked.filter((q) => /FROM posts/.test(q)),
    ["SELECT id, class, title, author, household, starts, ends, fields, state, last_act FROM posts WHERE class = $1 ORDER BY id"],
    "the read asks the posts table exactly the one reader's question");

  assert.equal(r.class, "quest");
  assert.deepEqual(r.finished, ["closed"]);
  assert.equal(r.total, 11);
  assert.deepEqual(r.posts.map((p) => p.fields.quest), QUEST_IDS, "the registry's own order");
  const send = r.posts[0];
  assert.deepEqual(Object.keys(send).sort(), ["author", "class", "fields", "household", "id", "latest", "responses", "state", "terms", "title"]);
  assert.deepEqual(send.terms, { title: "Reach out", source: "Send a letter to 5 different residents. Resets daily.", reward: "1 stamp each", cadence: "daily", target: 5 });
  assert.deepEqual([send.author, send.household, send.state, send.responses, send.latest.act], ["postmark-pen", "hh:the-town", "open", 0, "post"]);
  assert.ok(!("progress" in send), "progress is derived from the letters, never on the post");
  const welcome = r.posts.find((p) => p.fields.quest === "welcome-to-postmark");
  assert.deepEqual([welcome.state, welcome.latest.act], ["closed", "close"]);
  // what the Guild draws: the open daily and milestone posts, by their terms
  const guild = r.posts.filter((p) => p.state === "open" && ["daily", "milestone"].includes(p.terms.cadence)).map((p) => p.terms.title);
  assert.deepEqual(guild, BOARD);

  const one = await postsAtOffice({ class: "quest", post: "postmark-pen/first-idea" }, { now: NOW, townClone: TOWN });
  assert.equal(one.post.terms.title, "A first idea");
  await refusedWith(postsAtOffice({ class: "quest", post: "postmark-pen/nothing" }, { now: NOW, townClone: TOWN }), 404);
  await refusedWith(postsAtOffice({ class: "idea" }, { now: NOW, townClone: TOWN }), 422, /read: "ideas"/);
  await refusedWith(postsAtOffice({}, { now: NOW, townClone: TOWN }), 422, /which class/);
  // a registry that cannot be read is said, never a quiet copy of the stored title
  const blind = await postsAtOffice({ class: "quest" }, { now: NOW, townClone: join(DIR, "nowhere") });
  assert.match(blind.unavailable, /registry could not be read/);
  assert.equal(blind.posts[0].terms, null);
});

// ── 6 ───────────────────────────────────────────────────────────────────────

test("6 · the rebuild folds the quest acts back into exactly the rows the pen wrote, and a hand-edited row is drift", async () => {
  const { pen, posts } = setup();
  await seedQuestPosts({ hand: "wright", registry: REGISTRY, now: NOW });
  await closeAtTown({ post: "postmark-pen/first-idea" }, WRIGHT, { now: NOW });
  const out = await dryRun(pen);
  assert.equal(out.equal, true, out.drift.join("; "));
  assert.deepEqual([out.counts.quest_acts, out.counts.quests], [12, 11]);
  const quests = [...posts.values()].map((r) => ({ ...r, fields: { ...r.fields } }));
  quests[0].state = "closed";
  const acts = pen.rows().map((a) => ({ ...a, payload: JSON.parse(a.payload) }));
  assert.equal(compareRebuild({ posts: quests, responses: [] }, acts).equal, false, "an edited quest row read as equal");
});

// ── the town door ───────────────────────────────────────────────────────────

test("the town door: read: \"posts\" and read: \"quest\" serve read_posts, the alias with its class fixed", async () => {
  const { townApex, TOWN_READS } = await import("../src/town-apex.mjs");
  const { TOOLS } = await import("../src/mcp.mjs");
  const schemas = Object.fromEntries(TOOLS.map((t) => [t.name, t.inputSchema?.properties ?? {}]));
  assert.equal(TOWN_READS.posts.tool, "read_posts");
  const calls = [];
  const call = async (tool, fields) => { calls.push({ tool, fields }); return { ok: tool }; };
  await townApex({ read: "quest" }, null, { call, schemas });
  await townApex({ read: "posts", args: { class: "event" } }, null, { call, schemas });
  assert.deepEqual(calls, [{ tool: "read_posts", fields: { class: "quest" } }, { tool: "read_posts", fields: { class: "event" } }]);
});
