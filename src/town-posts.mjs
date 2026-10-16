// town-posts.mjs — THE TOWN'S POSTS, ONE READ THAT TAKES A CLASS (POS-294).
//
// The Posts project, § Ruled for phase 1: "one `posts` read that takes a class
// (the per-class reads become aliases, then retire). Every class declares its
// finished states." So:
//
//   town { read: "posts", args: { class, post? } }     GET /posts?class=…
//                                                       GET /posts/<author>/<slug>
//
// answers every post of the class as the general row (posts-fields.md § 4:
// class, id, title, author, household, state, latest, responses), plus what
// the class joins to it, and the class's `finished` states beside the list.
// `town { read: "quest" }` is the quest class's alias (unlisted on the menu).
//
// ── ONE QUESTION, ONE OWNER ─────────────────────────────────────────────────
//
// The posts table has one reader: household-posts.mjs § postRowsOf, which the
// household's own posts read already asks. This file asks it too, keeping every
// post instead of the house's, and adds nothing to what it reads from the
// table. A second SELECT on `posts` here would be two answers to one question.
//
// ── A QUEST'S TERMS ARE THE REGISTRY'S ──────────────────────────────────────
//
// A quest row carries its registry id (`fields.quest`). Its `terms` (title,
// source, reward, cadence, target) are joined from the town's
// quest-registry.json at read time, so the registry stays the source and an
// edit to it is on the next read. A row whose registry entry is gone says so
// (`terms: null`) rather than borrowing the stored title as if it were terms.
// Progress is not here: it is derived from the letters (read: "quests").
// Quests answer in the registry's own order, the order the board draws them.
//
// ── THE CLASSES ─────────────────────────────────────────────────────────────
//
// event, quest, bug and idea. An idea is a post since POS-290 (behind
// IDEA_POSTS for the acts; the read reports what the store holds, which is
// nothing until the switch has been on). The Think Tank's marks stay marks and
// are read at town { read: "ideas" }, beside these posts.
//
// ── THE BUG READ PAGES (POS-558, Darko 2026-10-10) ──────────────────────────
//
// "We already need a page-based load instead of just dropping all of them,
// because this is going to get really big really fast." The bug list answers
// in the office's paged-read grammar (queries.mjs: the roll, the mail,
// correspondents, regions): `limit` (default BUG_PAGE, max 200) and `offset`
// in; `total` (every bug), `shown`, `limit`, `offset`, `complete`, and
// `next_offset` with `more_note` while there is more, out. The order is the
// jar's (bugs.mjs § THE JAR'S ORDER: open by the furthest stage, the named,
// the legacy shelf, the set aside), so the pages read like the jar; the shared
// postOrder, which events and quests read, is not touched. A page cannot add
// up the town, so every
// page also carries `catchers`, the Hall of Fame's totals over the whole
// record (bugs.mjs § THE CATCHERS): the history is still read for every bug,
// as it was before the read paged. The other classes are not paged.
//
// ── A BUG CARRIES ITS OWN FIELDS ────────────────────────────────────────────
//
// A bug row (bugs.mjs) adds its class `fields` to the general row: the
// reporter's issue, steps and record, and whatever its advances set (size,
// critter and named_by at fixed, grade at briefed, `of` at duplicate). Its state is its stage.
//
// ── EVERY POST CARRIES ITS HISTORY (POS-547, generalized for POS-290) ───────
//
// Who did each stage is on the acts, and what each stage paid is on the signed
// ledger, so the read joins both: `history`, one row per act that moved the
// post, shaped by its class (post-history.mjs, the one reader; a bug's rows are
// bugs.mjs § THE HISTORY, an idea's ideas.mjs's, an event's and a quest's the
// post and its close). It rides on every row of the list as well as on
// the one post, because the Bug Catcher's page draws every bug's ladder from
// one read (measured on the 48 bugs of 2026-10-09 in POS-547's report). The ledger is the store's
// `stamp_lines` (066), never the town's file, read as a delta past what this
// process already read (post-history.mjs § the chain is read as a delta). An office whose store has no
// chain yet (before 066, or before its first sync) says so in `unavailable`
// and answers stamps_paid null, rather than calling every stage unpaid.

import { wholeNumber } from "./whole-number.mjs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { officeRead } from "./world2-pen.mjs";
import { postRowsOf, postOrder, TERMINAL_STATES, FIELDS } from "./household-posts.mjs";
import { EVENT_CLASS, refuse } from "./events.mjs";
import { QUEST_CLASS, QUEST_FINISHED, readQuestRegistry, questTerms } from "./quests.mjs";
import { BUG_CLASS, BUG_FINISHED, bugCatchersOf, bugJarOrder } from "./bugs.mjs";
import { IDEA_CLASS, IDEA_FINISHED, ideaResponsesOf } from "./ideas.mjs";
import { postHistoryVia, NO_CHAIN } from "./post-history.mjs";
import { ideaExtrasVia } from "./idea-store.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOWN_CLONE = () => process.env.TOWN_CLONE ?? resolve(HERE, "..", "town-clone");

/** Each class and the states it is finished in. An event's are the clock's `ended` and the stored `cancelled`. */
export const POST_CLASSES = Object.freeze({
  [EVENT_CLASS]: Object.freeze({ finished: TERMINAL_STATES }),
  [QUEST_CLASS]: Object.freeze({ finished: QUEST_FINISHED }),
  [BUG_CLASS]: Object.freeze({ finished: BUG_FINISHED }),
  [IDEA_CLASS]: Object.freeze({ finished: IDEA_FINISHED }),
});

/** The quest registry the office reads, from its own town clone. */
export const questRegistryAtOffice = (townClone = TOWN_CLONE()) => readQuestRegistry(townClone);

function judgePostsClass(fields) {
  const c = String(fields?.class ?? "").trim();
  if (!c) throw refuse(422, "which class?", `class: one of ${Object.keys(POST_CLASSES).join(", ")}`, { field: "class" });
  if (!Object.hasOwn(POST_CLASSES, c)) throw refuse(422, `"${c}" is not a post class`, `class: one of ${Object.keys(POST_CLASSES).join(", ")}`, { field: "class" });
  return c;
}

/** Bugs on one page of the bug read, unless the caller asks for another number (max 200). */
export const BUG_PAGE = 50;

/** One page of the bug list, in the paged-read grammar (queries.mjs § regionPage's shape). */
function bugPageOf(all, { limit, offset } = {}) {
  const n = Math.min(Math.max(wholeNumber(limit) || BUG_PAGE, 1), 200);
  const start = Math.max(wholeNumber(offset) || 0, 0);
  const page = all.slice(start, start + n);
  const next = start + page.length;
  const complete = next >= all.length;
  return {
    total: all.length, shown: page.length, limit: n, offset: start, complete,
    ...(complete ? {} : { next_offset: next,
      more_note: `${all.length - next} further bug${all.length - next === 1 ? "" : "s"} — call again with offset: ${next}` }),
    posts: page,
  };
}

const plain = ({ ...r }) => Object.fromEntries(Object.entries(r));   // own string keys only: the reader's symbols stay behind

// The history's one reader is post-history.mjs (POS-547's, generalized for
// every class); its "no chain" sentence is re-exported where the bug read's
// falsifiers have always found it.
export { NO_CHAIN };

/**
 * `town { read: "posts", args: { class, post?, limit?, offset? } }` (limit and offset page the bug class).
 * @param {{ now?: number, env?: object, townClone?: string }} ctx
 */
export async function postsAtOffice(fields = {}, { now = Date.now(), env = process.env, townClone = TOWN_CLONE() } = {}) {
  const cls = judgePostsClass(fields);
  const one = String(fields?.post ?? "").trim();
  let rows;
  let history = null;
  let extras = null;
  try {
    ({ rows, history, extras } = await officeRead(async (client) => {
      const rows = await postRowsOf(client, cls, now);
      const ids = rows.map((r) => r.id).filter((id) => !one || id === one);
      return { rows, history: await postHistoryVia(client, cls, ids),
        extras: cls === IDEA_CLASS ? await ideaExtrasVia(client, ids) : null };
    }, { env }));
  } catch (e) {
    if (e && typeof e.code === "number" && typeof e.defect === "string") throw e;
    throw refuse(503, "the posts live in the office's record, and the record cannot be read",
      "nothing is wrong with your call — ask again shortly", { cause: String(e?.message ?? e).slice(0, 160) });
  }
  let posts;
  let unavailable = history?.unavailable ?? null;
  // Every class carries its history (POS-547 for the bug, generalized): the
  // rows its class's mapper shapes, oldest first.
  const historyOf = (id) => history.byPost.get(id) ?? [];
  if (cls === QUEST_CLASS) {
    const registry = questRegistryAtOffice(townClone);
    if (!registry) unavailable = "the quest registry could not be read, so each quest's terms are null";
    const order = new Map((registry?.quests ?? []).map((q, i) => [q.id, i]));
    posts = rows.map((r) => {
      const f = r[FIELDS] ?? {};
      const entry = (registry?.quests ?? []).find((q) => q.id === f.quest) ?? null;
      return { ...plain(r), fields: { quest: f.quest ?? null }, terms: questTerms(entry), history: historyOf(r.id) };
    }).sort((a, b) => (order.get(a.fields.quest) ?? Infinity) - (order.get(b.fields.quest) ?? Infinity) || a.id.localeCompare(b.id));
  } else if (cls === BUG_CLASS) {
    // the jar's order, the bug read's own (bugs.mjs § THE JAR'S ORDER), never the shared postOrder
    posts = rows.map((r) => ({ ...plain(r), fields: { ...(r[FIELDS] ?? {}) },
      history: historyOf(r.id) })).sort(bugJarOrder);
  } else if (cls === IDEA_CLASS) {
    // An idea (POS-290) carries its body, its own fields (links, of), its
    // history, the awards recorded on it (and what the chain shows each paid),
    // its backing and its sign-ups.
    posts = [...rows].sort(postOrder).map((r) => ({ ...plain(r), body: extras.bodies.get(r.id) ?? "", fields: { ...(r[FIELDS] ?? {}) },
      history: historyOf(r.id), awards: history.awardsByPost.get(r.id) ?? [],
      ...ideaResponsesOf(extras.responses.get(r.id) ?? []) }));
  } else {
    posts = [...rows].sort(postOrder).map((r) => ({ ...plain(r), history: historyOf(r.id) }));
  }
  const head = { as_of: new Date(now).toISOString(), class: cls, finished: [...POST_CLASSES[cls].finished],
    ...(unavailable ? { unavailable } : {}) };
  if (one) {
    const hit = posts.find((p) => p.id === one);
    if (!hit) throw refuse(404, `no ${cls} "${one}"`, `town { read: "posts", args: { class: "${cls}" } } lists them`);
    return { ...head, post: hit };
  }
  if (cls === BUG_CLASS) {
    const { posts: page, ...paging } = bugPageOf(posts, fields);
    return { ...head, ...paging, catchers: bugCatchersOf(posts, { unavailable: Boolean(history?.unavailable) }), posts: page };
  }
  return { ...head, total: posts.length, posts };
}
