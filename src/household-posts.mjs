// household-posts.mjs — a household's posts, one read, two readers (POS-293).
//
// Keemin, 2026-09-28: "Posts are what we want. Marks are what Postmark is.
// Mail is whom we trust." The household page opens on the first of the three,
// and this is its read: `household { read: "posts", handle }` (GET /household
// ?read=posts&handle=…), and the same answer as the doorstep's `posts` segment.
//
// ── TWO LISTS, FOR THE HANDLE'S WHOLE HOUSE ─────────────────────────────────
//
//   put_up       posts the house's residents authored
//   taking_part  posts by others where a resident of the house holds a
//                response (an RSVP, a stake on an idea)
//
// Each row carries ONLY the general fields (design-notes/posts-fields.md § 4):
// class, id, title, author, household, state, latest {act, at}, responses,
// role, stake, ours. Nothing reads a class's own `fields`, so a reader draws
// every class with one row and branches on `class` for nothing but a colour.
//
// ── THE CLASSES TODAY ───────────────────────────────────────────────────────
//
// EVENTS are the `posts` table (028). The window is the calendar's: not ended,
// or ended within ENDED_LIST_DAYS. The state is the clock's, read at read time
// through `phaseAt` — the calendar's one phase decision — and named in the
// post's words: announced, live (doors open or underway), ended; cancelled is
// the one state an act stores. Nothing new is stored.
//
// IDEAS are still Think Tank marks until POS-290, read where `town { read:
// "ideas" }` reads them (`ideasTank`) and backed where `town { read: "stake" }`
// reads the backing (the town engine's `worldStakeState`, the stamp ledger's
// world-stake rows). Every standing idea is in the window, and every one is
// `posted`: the lifecycle states are POS-289's, not this read's to invent.
// An idea's title is its body, resident text, never folded into a sentence of
// the office's.
//
// QUESTS are not here. The town posts them and the household page keeps its
// quest board beside these lists.
//
// ── PUBLIC, AND IT NEVER LOOKS AT WHAT IS NOT ───────────────────────────────
//
// Posts, RSVPs and stakes are the town's public record. The responses query
// names its columns (post, handle, state); an RSVP's harness and budget live
// in `responses.fields` and `household_harnesses`, and this file reads neither.
//
// ── A HALF THAT CANNOT BE READ IS SAID ──────────────────────────────────────
//
// Each class is read on its own. One that does not answer leaves its rows out
// and puts a line in `unavailable` naming it, so a reader never takes "the
// record did not answer" for "the house has none".

import { resolve, dirname, join } from "node:path";
import { existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import { officeRead } from "./world2-pen.mjs";
import { ideasTank } from "./world-classes.mjs";
import { resolveHouse } from "./household-deriver.mjs";
import { registryFor } from "./house-bundle.mjs";
import { EVENT_CLASS, ENDED_LIST_DAYS, STATE_CANCELLED, phaseAt } from "./events.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOWN_CLONE = process.env.TOWN_CLONE ?? resolve(HERE, "..", "town-clone");

/** Each list is cut here, and carries its true total beside the cut. */
export const POSTS_CAP = 20;

const DAY_MS = 86_400_000;
const IDEA_CLASS = "idea";
const IDEA_STATE = "posted";
/** A response counts while it stands (posts-fields.md § 4). */
const COUNTED = new Set(["standing", "accepted"]);

/** The two vocabularies of the event acts (POS-288 D2), read in the post's. */
const ACT_WORD = Object.freeze({ host: "post", "amend-event": "amend", "cancel-event": "close" });

const POST_COLUMNS = "id, class, title, author, household, starts, ends, fields, state, last_act";

/** An event's state from the clock: announced | live | ended, or cancelled. */
export function eventState(row, now) {
  if (row.state === STATE_CANCELLED) return STATE_CANCELLED;
  const starts = new Date(row.starts).toISOString();
  const ends = new Date(row.ends).toISOString();
  const fields = typeof row.fields === "string" ? JSON.parse(row.fields) : (row.fields ?? {});
  const phase = phaseAt({ doors_open: fields.doors_open ?? starts, starts, ends }, now);
  return phase === "doors-open" || phase === "underway" ? "live" : phase;
}

/**
 * The house the handle lives in: `{ key, members }`. A handle no house names
 * is its own house (`solo:<handle>`). `unread` is set when the registry could
 * not be read, and the answer then covers the handle alone.
 */
async function houseOf(handle, { clone, readers }) {
  const reg = await registryFor(clone, readers);
  if (!reg) return { resolve: null, unread: "the household registry could not be read, so this answers for the resident alone" };
  const houses = reg.registry?.households ?? {};
  const resolveOne = (h) => {
    const { slug } = resolveHouse(h, reg.registry, reg.pins);
    return slug
      ? { key: `hh:${slug}`, members: [...new Set((houses[slug]?.residents ?? []).map(String))] }
      : { key: `solo:${h}`, members: [h] };
  };
  return { resolve: resolveOne };
}

// ── THE ONE READER OF THE POSTS PROJECTION (POS-294) ───────────────────────
//
// Wright, reviewing POS-294's shape: "one question, one owner". This house's
// read and the town's `posts` read (town-posts.mjs) ask the posts table the
// same question, a class's posts with their counted responses and their
// newest act, so they share this function and nothing else reads the table
// for them. What differs is only who is asking: the house keeps the posts
// its residents wrote or answered (`keep`), the town keeps them all.
//
// THE WINDOW is the class's. An event is in it while it has not ended or
// ended within ENDED_LIST_DAYS, the calendar's own window. A class with no
// span (a quest) has no window: every post of it is answered, open or not.
//
// Each row is the general row (posts-fields.md § 4) without the reader's own
// keys (role, stake, ours): class, id, title, author, household, state,
// latest, responses. `RESPONDENTS` (a symbol, never on an answer) carries who
// answered, for a reader that needs it; `STARTS` carries the span's start for
// the order.

const WINDOWED = new Set([EVENT_CLASS]);
export const RESPONDENTS = Symbol("respondents");

/** A post's state as the reader sees it: an event's from the clock, any other class's as its acts stored it. */
const stateOf = (p, now) => (p.class === EVENT_CLASS ? eventState(p, now) : p.state);

/**
 * `cls`'s posts, on a client inside the caller's read. `keep(post, who)` is
 * asked before the acts are read, `who` being the handles whose responses
 * stand on it, so a reader that keeps a few reads the acts of those few only.
 */
export async function postRowsOf(client, cls, now, { keep = null } = {}) {
  const { rows: posts } = WINDOWED.has(cls)
    ? await client.query(`SELECT ${POST_COLUMNS} FROM posts WHERE class = $1 AND ends > $2 ORDER BY starts, id`,
      [cls, new Date(now - ENDED_LIST_DAYS * DAY_MS).toISOString()])
    : await client.query(`SELECT ${POST_COLUMNS} FROM posts WHERE class = $1 ORDER BY id`, [cls]);
  if (!posts.length) return [];
  const { rows: responses } = await client.query(
    "SELECT post, handle, state FROM responses WHERE post = ANY($1) ORDER BY post, handle", [posts.map((p) => p.id)]);
  const who = new Map();
  for (const r of responses) {
    if (!COUNTED.has(r.state)) continue;
    who.set(r.post, [...(who.get(r.post) ?? []), r.handle]);
  }
  const kept = keep ? posts.filter((p) => keep(p, who.get(p.id) ?? [])) : posts;
  if (!kept.length) return [];
  // every act on these posts, oldest first, so the last one kept is the newest:
  // a post, its amends, its RSVPs and its announcements — a handful each
  const { rows: acts } = await client.query(
    "SELECT id, object, action, at FROM acts WHERE class = $1 AND object = ANY($2) ORDER BY id",
    [cls, kept.map((p) => p.id)]);
  const latest = new Map(acts.map((a) => [a.object, { act: ACT_WORD[a.action] ?? a.action, at: new Date(a.at).toISOString() }]));
  return kept.map((p) => ({
    class: p.class,
    id: p.id,
    title: p.title,
    author: p.author,
    household: p.household ?? null,
    state: stateOf(p, now),
    latest: latest.get(p.id) ?? null,
    responses: (who.get(p.id) ?? []).length,
    // the span's start, for the order only; never on the answer (§ ORDER)
    [STARTS]: p.starts == null ? null : new Date(p.starts).toISOString(),
    [RESPONDENTS]: who.get(p.id) ?? [],
    [FIELDS]: typeof p.fields === "string" ? JSON.parse(p.fields) : (p.fields ?? {}),
  }));
}

/** The events half: `{ rows }` or `{ unavailable }`. */
async function eventRows(members, now, { env }) {
  const house = new Set(members);
  try {
    return await officeRead(async (client) => {
      const rows = await postRowsOf(client, EVENT_CLASS, now,
        { keep: (p, who) => house.has(p.author) || who.some((h) => house.has(h)) });
      return {
        rows: rows.map((r) => ({
          ...r,
          role: house.has(r.author) ? "author" : "participant",
          stake: 0,
          ours: 0,
        })),
      };
    }, { env });
  } catch {
    return { unavailable: "the events could not be read from the office's record" };
  }
}

// ── THE BACKING, READ ONCE PER LEDGER ───────────────────────────────────────
//
// The stamp ledger is the town's whole money history (3.3 MB, 15,447 entries
// on 2026-09-28) and the engine folds it from the top on every call: ~70 ms,
// measured on this machine. `town { read: "stake" }` pays that once per mark
// asked about; this read rides every doorstep, so it pays it once per LEDGER.
// The key is the file's own stamp (mtime and size), the idiom the office's
// other file-backed caches keep (docs/read-workers.md), so a crossing that
// appends to the ledger is read on the next call and never before.
let backingCache = null;

async function backingOf(townClone) {
  const ledger = join(townClone, "WHITE_PAGES", "stamp-ledger.md");
  let stamp = "absent";
  try { const st = statSync(ledger); stamp = `${st.mtimeMs}:${st.size}`; } catch { /* the engine reads an absent ledger as empty */ }
  const key = `${townClone}|${stamp}`;
  if (backingCache?.key === key) return backingCache.value;
  const stake = await import(pathToFileURL(join(townClone, "tools", "world-stake.mjs")));
  const { classifyEntry } = await import(pathToFileURL(join(townClone, "tools", "stamp-mint.mjs")));
  const state = stake.worldStakeState(townClone);
  // who holds what on each mark, and the newest stake or unstake on it
  const holders = new Map();
  for (const [k, n] of state.positions) {
    if (!(n > 0)) continue;
    const cut = k.lastIndexOf("|");
    const mark = k.slice(0, cut);
    holders.set(mark, [...(holders.get(mark) ?? []), { handle: k.slice(cut + 1), n }]);
  }
  const moved = new Map();
  for (const e of state.entries) {
    const c = classifyEntry(e.canonical);
    if (c.kind === "world-stake" || c.kind === "world-unstake")
      moved.set(c.mark, { act: c.kind === "world-stake" ? "stake" : "unstake", at: c.date });
  }
  const value = { escrow: state.escrow, holders, moved };
  backingCache = { key, value };
  return value;
}

/** The ideas half: `{ rows }` or `{ unavailable }`. */
async function ideaRows(members, whose, { townClone }) {
  const house = new Set(members);
  const tank = ideasTank();
  if (tank.source !== "store") return { unavailable: "the Think Tank could not be read from the world record" };
  if (!tank.ideas.length) return { rows: [] };
  if (!existsSync(join(townClone, "tools", "world-stake.mjs")))
    return { unavailable: "the ideas' backing could not be read: the office has no town clone carrying the stamp ledger" };
  let backing;
  try { backing = await backingOf(townClone); }
  catch { return { unavailable: "the ideas' backing could not be read from the stamp ledger" }; }
  const rows = [];
  for (const idea of tank.ideas) {
    const held = backing.holders.get(idea.id) ?? [];
    const ours = held.filter((x) => house.has(x.handle)).reduce((a, x) => a + x.n, 0);
    const author = String(idea.by ?? idea.id.split("/")[0]);
    const role = house.has(author) ? "author" : ours > 0 ? "participant" : null;
    if (!role) continue;
    const posted = idea.date ? { act: "post", at: String(idea.date) } : null;
    const last = backing.moved.get(idea.id);
    rows.push({
      class: IDEA_CLASS,
      id: idea.id,
      title: idea.body ?? "",
      author,
      household: whose(author),
      state: IDEA_STATE,
      latest: last && (!posted || last.at >= posted.at) ? last : posted,
      responses: held.length,
      role,
      stake: backing.escrow.get(idea.id) ?? 0,
      ours,
    });
  }
  return { rows };
}

// ── ORDER (Wright's review, 2026-09-28) ─────────────────────────────────────
//
// What is still open comes first, what is over comes last. Among the open, a
// post with a span (a start the town is counting down to) sorts by the soonest
// start, and a post with none by its newest act; spans lead, because a start
// is a date on the reader's calendar. The terminal ones (ended, cancelled)
// follow, newest act first. It is decided HERE, before the cut at POSTS_CAP,
// so the cut keeps what is live rather than whatever acted last. The keys are
// general: a state, a span, an act. No class is asked.
const STARTS = Symbol("starts");
/** A post's class `fields`, for a class reader that joins them (a quest's registry id); never on this read's answer. */
export const FIELDS = Symbol("fields");
export const TERMINAL_STATES = Object.freeze(["ended", STATE_CANCELLED]);
const terminal = (r) => TERMINAL_STATES.includes(r.state);
const newest = (a, b) => String(b.latest?.at ?? "").localeCompare(String(a.latest?.at ?? ""));
export function postOrder(a, b) {
  return (terminal(a) - terminal(b))
    || (terminal(a) ? newest(a, b)
      : (!a[STARTS] - !b[STARTS]) || (a[STARTS] ? a[STARTS].localeCompare(b[STARTS]) : newest(a, b)))
    || a.id.localeCompare(b.id);
}

/**
 * `household { read: "posts", handle }`.
 *
 * @param {string} handle  any resident of the house; the answer is the house's
 * @param {{ now?: number, env?: object, clone?: string|null, townClone?: string, readers?: object }} ctx
 */
export async function householdPosts(handle, { now = Date.now(), env = process.env, clone = null, townClone = TOWN_CLONE, readers = {} } = {}) {
  const h = String(handle ?? "").trim();
  const house = await houseOf(h, { clone, readers });
  const mine = house.resolve ? house.resolve(h) : { key: `solo:${h}`, members: [h] };
  const whose = (author) => (house.resolve ? house.resolve(author).key : author === h ? mine.key : null);
  const [events, ideas] = await Promise.all([
    eventRows(mine.members, now, { env }),
    ideaRows(mine.members, whose, { townClone }),
  ]);
  const rows = [...(events.rows ?? []), ...(ideas.rows ?? [])].sort(postOrder);
  const list = (role) => {
    const all = rows.filter((r) => r.role === role);
    const plain = ({ [STARTS]: _starts, [RESPONDENTS]: _who, [FIELDS]: _fields, ...r }) => r;
    return { total: all.length, shown: Math.min(all.length, POSTS_CAP), rows: all.slice(0, POSTS_CAP).map(plain) };
  };
  const unavailable = [house.unread, events.unavailable, ideas.unavailable].filter(Boolean);
  return {
    household: mine.key,
    residents: mine.members,
    put_up: list("author"),
    taking_part: list("participant"),
    ...(unavailable.length ? { unavailable } : {}),
  };
}
