// quests.mjs — THE QUEST CLASS OF THE POST MACHINE (POS-294), pure.
//
// Keemin, 2026-09-28: "All quests are technically posts. They are the town's
// posts. Even standing quests. They are the town's way of saying 'we want you
// sending thoughtful letters to one another'."
//
// The Posts project, § Ruled for phase 1:
//   · quest: open → closed; only the town posts and closes. A standing quest
//     stays open until retired, its progress derived from the letters, and
//     only its reward mint recorded. Finished: closed.
//   · A town post's author is `postmark-pen`, household `hh:the-town` ("the
//     founder (DARKO) answers for its pen"). The act records whose hand
//     posted, amended or closed it.
//
// ── ONE ROW PER QUEST, POINTING AT ITS REGISTRY ENTRY ───────────────────────
//
// The town's quest-registry.json stays the source of a quest's terms (title,
// source, reward, cadence, target). The post row carries `fields.quest`, the
// registry id, and the read joins the terms from the registry at read time,
// so a registry edit is on the next read and never a second copy to keep in
// step. The row's own title and body are what the registry said when it was
// posted: the act's record of what was put up, not the terms.
//
// Progress is not here. It stays derived from the letters (the town's
// tools/quest-progress.mjs), and the reward mint stays the stamp ledger's, so
// nothing about a quest's progress is stored.
//
// ── NOT EVERY REGISTRY ROW ──────────────────────────────────────────────────
//
// The `ongoing` rows are the funding pots (darko-fund, keeping-ec2). Pots
// becoming quests is POS-291, after the September close; this class refuses
// them by name.

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { refuse } from "./events.mjs";
import { PEN_HANDLE } from "./earpiece.mjs";

export const QUEST_CLASS = "quest";
export const STATE_OPEN = "open";
export const STATE_CLOSED = "closed";
/** The class's lifecycle, and the states it is finished in (the Posts project: "every class declares its finished states"). */
export const QUEST_STATES = Object.freeze([STATE_OPEN, STATE_CLOSED]);
export const QUEST_FINISHED = Object.freeze([STATE_CLOSED]);

/** The town's own pen is every quest's author (the ruling above). */
export const QUEST_AUTHOR = PEN_HANDLE;

// WHOSE HAND MAY POST AND CLOSE A TOWN QUEST. Wright's ruling on POS-294,
// 2026-09-28, inside Keemin's shape of the same day ("only the town posts and
// closes"): wright and keemin, and nobody else. Widening it (the Registrar,
// the postmaster) is Keemin's later call, not a default.
export const QUEST_HANDS = Object.freeze(["wright", "keemin"]);

/** The registry cadences that are quests; `ongoing` is the pots' (POS-291). */
export const QUEST_CADENCES = Object.freeze(["daily", "milestone", "one-time"]);
export const POT_CADENCE = "ongoing";

export const QUEST_REGISTRY_FILE = "quest-registry.json";

/** A quest post's id: the pen's, by the registry id. */
export const questPostId = (questId) => `${QUEST_AUTHOR}/${questId}`;

// ── the registry, read from the town clone ──────────────────────────────────
//
// Cached on the file's own stamp (mtime and size), the idiom of the office's
// other file-backed caches: a pull that changes the file is read on the next
// call and never before.
let cache = null;

/** `{ quests: [...] }` from the town clone, or null when it cannot be read. */
export function readQuestRegistry(townClone) {
  const file = join(townClone, QUEST_REGISTRY_FILE);
  let stamp;
  try { const st = statSync(file); stamp = `${file}|${st.mtimeMs}|${st.size}`; } catch { return null; }
  if (cache?.stamp === stamp) return cache.value;
  let value;
  try { value = JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
  if (!Array.isArray(value?.quests)) return null;
  cache = { stamp, value };
  return value;
}

/** The registry's quests that are posts, in the registry's own order. */
export const questEntries = (registry) => (registry?.quests ?? []).filter((q) => QUEST_CADENCES.includes(q?.cadence));

/** The registry entry a `post` names, or a refusal that says which it is not. */
export function judgeQuestEntry(registry, questId) {
  const id = String(questId ?? "").trim();
  if (!id) throw refuse(422, "which quest?", 'quest: "<registry id>", as the town\'s quest-registry.json names it', { field: "quest" });
  if (!registry) throw refuse(503, "the quest registry could not be read", "the office reads it from its town clone; nothing was written");
  const entry = (registry.quests ?? []).find((q) => q?.id === id);
  if (!entry) throw refuse(404, `no quest "${id}" in the registry`, `the registry's quests: ${questEntries(registry).map((q) => q.id).join(", ")}`, { field: "quest" });
  if (entry.cadence === POT_CADENCE)
    throw refuse(422, `"${id}" is a funding pot, not a quest post`, "pots becoming quests is a later ruling (POS-291); the pots stay on read: \"quests\"", { field: "quest" });
  if (!QUEST_CADENCES.includes(entry.cadence))
    throw refuse(422, `"${id}" has cadence "${entry.cadence}", which is not a quest's`, `a quest's cadence is one of ${QUEST_CADENCES.join(", ")}`, { field: "quest" });
  return entry;
}

/**
 * The hand: the caller's resident, who must be one of QUEST_HANDS. The act
 * names it; the post's author stays the pen.
 */
export function judgeQuestHand(fields, key) {
  const held = [...(key?.handles ?? [])];
  const named = String(fields?.handle ?? "").trim();
  const hand = named || (held.length === 1 ? held[0] : held.find((h) => QUEST_HANDS.includes(h)) ?? "");
  if (named && !held.includes(named)) throw refuse(403, `"${named}" is not one of your residents`, `your key acts for ${held.join(", ") || "no resident"}`);
  if (!hand || !QUEST_HANDS.includes(hand))
    throw refuse(403, "only the town posts and closes its quests",
      `a quest is the town's post, authored by ${QUEST_AUTHOR}; the hands that may put one up or close it are ${QUEST_HANDS.join(" and ")}`);
  return hand;
}

/** The terms a quest post shows, joined from its registry entry. */
export function questTerms(entry) {
  if (!entry) return null;
  const { title, source, reward, cadence, target } = entry;
  return { title, source, reward, cadence, target: target ?? null };
}

/**
 * The quest's refusals for the verbs its class does not take. The registry
 * holds the terms, so there is nothing to amend; open → closed is `close`.
 */
export const QUEST_NO_AMEND = () => refuse(422, "a quest is not amended",
  "a quest's terms are the town's quest-registry.json; change the registry, and the read shows it");
export const QUEST_NO_ADVANCE = () => refuse(422, "a quest has no advance",
  "a quest is open until the town closes it: town { do: \"close\", args: { post } }");
