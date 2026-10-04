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
// event, quest and bug. An idea is still a Think Tank mark until POS-290, so
// class: "idea" is refused by name with the read that answers it.
//
// ── A BUG CARRIES ITS OWN FIELDS ────────────────────────────────────────────
//
// A bug row (bugs.mjs) adds its class `fields` to the general row: the
// reporter's issue, steps and record, and whatever its advances set (size,
// critter and named_by at fixed, grade at briefed, `of` at duplicate). Its state is its stage. Who
// was credited at each stage is on the advance acts, and the stage pass
// (tools/bug-stage-plan.mjs) reads it there.

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { officeRead } from "./world2-pen.mjs";
import { postRowsOf, postOrder, TERMINAL_STATES, FIELDS } from "./household-posts.mjs";
import { EVENT_CLASS, refuse } from "./events.mjs";
import { QUEST_CLASS, QUEST_FINISHED, readQuestRegistry, questTerms } from "./quests.mjs";
import { BUG_CLASS, BUG_FINISHED } from "./bugs.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOWN_CLONE = () => process.env.TOWN_CLONE ?? resolve(HERE, "..", "town-clone");

/** Each class and the states it is finished in. An event's are the clock's `ended` and the stored `cancelled`. */
export const POST_CLASSES = Object.freeze({
  [EVENT_CLASS]: Object.freeze({ finished: TERMINAL_STATES }),
  [QUEST_CLASS]: Object.freeze({ finished: QUEST_FINISHED }),
  [BUG_CLASS]: Object.freeze({ finished: BUG_FINISHED }),
});

/** The quest registry the office reads, from its own town clone. */
export const questRegistryAtOffice = (townClone = TOWN_CLONE()) => readQuestRegistry(townClone);

function judgePostsClass(fields) {
  const c = String(fields?.class ?? "").trim();
  if (!c) throw refuse(422, "which class?", `class: one of ${Object.keys(POST_CLASSES).join(", ")}`, { field: "class" });
  if (c === "idea") throw refuse(422, "ideas are not posts yet", 'an idea is still a Think Tank mark (POS-290): town { read: "ideas" } answers them', { field: "class" });
  if (!Object.hasOwn(POST_CLASSES, c)) throw refuse(422, `"${c}" is not a post class`, `class: one of ${Object.keys(POST_CLASSES).join(", ")}`, { field: "class" });
  return c;
}

const plain = ({ ...r }) => Object.fromEntries(Object.entries(r));   // own string keys only: the reader's symbols stay behind

/**
 * `town { read: "posts", args: { class, post? } }`.
 * @param {{ now?: number, env?: object, townClone?: string }} ctx
 */
export async function postsAtOffice(fields = {}, { now = Date.now(), env = process.env, townClone = TOWN_CLONE() } = {}) {
  const cls = judgePostsClass(fields);
  const one = String(fields?.post ?? "").trim();
  let rows;
  try {
    rows = await officeRead((client) => postRowsOf(client, cls, now), { env });
  } catch (e) {
    if (e && typeof e.code === "number" && typeof e.defect === "string") throw e;
    throw refuse(503, "the posts live in the office's record, and the record cannot be read",
      "nothing is wrong with your call — ask again shortly", { cause: String(e?.message ?? e).slice(0, 160) });
  }
  let posts;
  let unavailable = null;
  if (cls === QUEST_CLASS) {
    const registry = questRegistryAtOffice(townClone);
    if (!registry) unavailable = "the quest registry could not be read, so each quest's terms are null";
    const order = new Map((registry?.quests ?? []).map((q, i) => [q.id, i]));
    posts = rows.map((r) => {
      const f = r[FIELDS] ?? {};
      const entry = (registry?.quests ?? []).find((q) => q.id === f.quest) ?? null;
      return { ...plain(r), fields: { quest: f.quest ?? null }, terms: questTerms(entry) };
    }).sort((a, b) => (order.get(a.fields.quest) ?? Infinity) - (order.get(b.fields.quest) ?? Infinity) || a.id.localeCompare(b.id));
  } else if (cls === BUG_CLASS) {
    posts = [...rows].sort(postOrder).map((r) => ({ ...plain(r), fields: { ...(r[FIELDS] ?? {}) } }));
  } else {
    posts = [...rows].sort(postOrder).map(plain);
  }
  const head = { as_of: new Date(now).toISOString(), class: cls, finished: [...POST_CLASSES[cls].finished],
    ...(unavailable ? { unavailable } : {}) };
  if (one) {
    const hit = posts.find((p) => p.id === one);
    if (!hit) throw refuse(404, `no ${cls} "${one}"`, `town { read: "posts", args: { class: "${cls}" } } lists them`);
    return { ...head, post: hit };
  }
  return { ...head, total: posts.length, posts };
}
