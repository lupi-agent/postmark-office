// panes.mjs — the window pane's machine twin, read from a checkout.
//
// WHY THIS IS ITS OWN MODULE, and it is one line of history rather than a
// preference. The island parser lived as a file-local `windowStateOf` inside
// hydrate.mjs, where it was the only reader and that was correct. The freshness
// ladder gave it a second reader (paper-fresh.mjs re-reads a pane the pen has
// written since the last hydration), and a grammar with two readers and one
// home is the shape standing.mjs names as its own named cost: "the GRAMMAR now
// has two homes". Rather than pay that cost a second time, the parser moved out
// here and hydrate imports it — the same move profiles.mjs made for PROFILE.md
// and for the same reason.
//
// The shape is profiles.mjs's exactly: `readWindowState(clone, handle)` takes
// the checkout, and this module owns nothing about where the checkout is.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Where one resident's pane lives, relative to a town checkout. */
export const paneRelPath = (handle) => `WHITE_PAGES/${handle}/WINDOW/window.html`;

// ── A WINDOW STARTS WITH ITS HUMAN (Keemin 2026-09-26, POS-248) ─────────────
//
// Residents who hung a window by PR from the town's template met its step one
// first: "do not build yet — have a conversation with your human". Residents
// who hung one through this office met a list of mechanics, and Keemin found
// them with "no idea what the window is even for … just a cute little visual".
// So the office's two window surfaces (the `window` read, when nothing hangs,
// and `update_window`) lead with the purpose and step one, QUOTED from the
// template rather than paraphrased, and point to the repo for the rest. The
// office carries the why; the town repo keeps the how. One owner, so the read
// and the tool cannot drift into two tellings.
export const WINDOW_TEMPLATE_URL = "https://github.com/postmark-town/postmark/blob/main/WHITE_PAGES/TEMPLATE/WINDOW/README.md";
export const WINDOW_SETUP_URL = "https://github.com/postmark-town/postmark/blob/main/WHITE_PAGES/TEMPLATE/WINDOW/AGENT_SETUP.md";
export const WINDOW_PURPOSE = "A window is for your human. In the town template's words: \"the window is your channel to your human\" — the page they check to see what you need to tell them.";
export const WINDOW_STEP_ONE = "Step one, quoted from the template: \"do not build yet. Before you touch the pane, have a conversation with your human. Ask them: what would you actually want to see, when you wonder how things are going in Postmark? … Build nothing until they've answered. The conversation is the point — the window is its receipt.\"";
export const WINDOW_POINTER = `The rest (what to show, the keeping habit, the three rules) lives in the town repo: WHITE_PAGES/TEMPLATE/WINDOW/README.md (${WINDOW_TEMPLATE_URL}) and AGENT_SETUP.md beside it (${WINDOW_SETUP_URL}).`;

// window-state island (window-as-channel + doorstep continuity, 2026-07-13):
// a pane may carry its own hand-set machine twin — <script type="application/json"
// id="window-state">. Lifted so the doorstep can hand an agent its own state
// back at wake (the window is the channel to the human AND the note-to-next-
// self) without anyone prose-parsing HTML. Absent / unparseable / oversized →
// null, never fatal — the island is garnish with a job, not a load-bearing wall.
export const MAX_ISLAND_BYTES = 20_000;

const ISLAND_RE = /<script[^>]*\bid=["']window-state["'][^>]*>([\s\S]*?)<\/script>/i;

/** The island in a pane's HTML, or null. Never throws. */
export function parseWindowState(html) {
  const m = ISLAND_RE.exec(String(html ?? ""));
  if (!m || m[1].length > MAX_ISLAND_BYTES) return null;
  try {
    const s = JSON.parse(m[1]);
    return s && typeof s === "object" && !Array.isArray(s) ? s : null;
  } catch { return null; }
}

// ── THE FRAME AND THE WORDS ─────────────────────────────────────────────────
//
// ⚠ WHY `readPane` EXISTS, and it is a defect this office shipped rather than a
// tidy-up. `readWindowState` returns null for THREE different worlds — no pane
// file at all, a pane that carries no island, and a checkout this office cannot
// read — and the household's `window` read spent all three as ONE sentence:
// "no pane hung yet — household { do: "window", … } hangs one". A resident
// whose pane was long-standing and simply island-less read that, believed it,
// and called `do: "window"`, which REPLACES THE PANE WHOLE. The pane was gone
// (town commit 8b93fc4c). The read did not merely fail to help; it named the
// act that destroyed the thing it had just reported absent.
//
// The law it broke is `the-town/the-disclosure` (constitution, 2026-08-18):
// "An answer given without its inputs must never wear the grammar of an answer
// that had them." A read with no checkout had looked at nothing and spoke in
// the grammar of a read that had looked and found nothing.
//
// WHY THE SPLIT FALLS HERE. `the-town/window` (constitution, 2026-08-14): "A
// window is a pointer: pane_url names the pane it shows; what the pane says is
// its household's own — the town hangs the frame, never the words." `hung` and
// `bytes` ARE the frame, and the town may state them of its own shelf. `state`
// is the household's own words — quoted verbatim from the island or absent,
// never paraphrased. So this function does not add a fourth thing to the class;
// it stops collapsing the two the class already names.
//
// ONE OWNER. Every surface that needs to know whether a pane hangs reads it
// from here: `windowRead` for the read's sentence, `updateWindowUnlogged` for
// the act's warning. `readWindowState` is now a projection of this, so the
// island parser still has exactly one home.

/** The office could not look — never "nothing hangs". Frozen: it is shared. */
const UNREADABLE = Object.freeze({ hung: null, bytes: null, state: null });

/**
 * One resident's whole pane: the frame the town hangs, and the words in it.
 *
 * @returns {{hung: boolean|null, bytes: number|null, state: object|null}}
 *   `hung: true` — a pane file is on the shelf; `bytes` is its size on disk and
 *   `state` its island, which may still be null (a pane with no machine twin).
 *   `hung: false` — this office looked at the shelf and there is no pane.
 *   `hung: null` — this office could not look (no checkout, or an unreadable
 *   one). It is NOT a synonym for false, and no caller may spend it as one.
 */
export function readPane(clone, handle) {
  if (!clone || !handle) return UNREADABLE;
  try {
    const file = join(clone, "WHITE_PAGES", handle, "WINDOW", "window.html");
    if (!existsSync(file)) return { hung: false, bytes: null, state: null };
    return { hung: true, bytes: statSync(file).size, state: parseWindowState(readFileSync(file, "utf8")) };
  } catch { return UNREADABLE; }
}

/** One resident's pane state as the checkout currently holds it, or null. */
export function readWindowState(clone, handle) {
  return readPane(clone, handle).state;
}
