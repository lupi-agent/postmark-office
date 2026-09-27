// derive-board.mjs — one author, N renders, for the operator lane's own board.
//
// Reads open-loops.md (THE author surface) and machine-writes the two derived
// islands inside Wright's window pane:
//
//   <script type="application/json" id="board-data">    — the full board, rows
//     pre-formatted as safe HTML; the pane's JS renders it at view time.
//   <script type="application/json" id="window-state">  — the machine twin the
//     office lifts at hydrate (doorstep continuity); open rows only.
//
// Born 2026-07-15 (Keemin-directed, same sitting as the #321 won't-build
// ruling): the pane's board section had been a HAND-COPIED duplicate of
// open-loops.md, rewritten every round — the exact duplication-drift class the
// night-record gold deleted from the Observatory that morning. Now the .md is
// the only surface a round edits; this script is the render.
//
// Fails loud, never partial: any malformed input (missing file, wrong column
// count, missing island in the pane) exits 1 and leaves the pane untouched.
// Zero-dependency (Node built-ins only, like lint.mjs / board-html.mjs).
//
// Run:  node tools/derive-board.mjs [--board <path>] [--window <path>] [--dry]

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : dflt;
};
const DRY = args.includes("--dry");
const BOARD = resolve(opt("--board", "G:/openclaw/wright/memory/topics/postmark-open-loops.md"));
const WINDOW = resolve(opt("--window", "G:/Postmark/repo-clones/wright/town/WHITE_PAGES/wright/WINDOW/operator.html"));  // the pane split 2026-08-14: the operator desk is its own room; window.html is the resident pane and carries no islands
const ISSUES = "https://github.com/postmark-town/postmark/issues/";

const die = (msg) => { console.error(`derive-board: ${msg}`); process.exit(1); };

if (!existsSync(BOARD)) die(`no board at ${BOARD}`);
if (!existsSync(WINDOW)) die(`no pane at ${WINDOW}`);

const md = readFileSync(BOARD, "utf8").replace(/\r/g, "");

// ── frontmatter: last-refreshed ───────────────────────────────────────────────
const lr = /^last-refreshed:\s*(.+)$/m.exec(md);
if (!lr) die("board has no last-refreshed line — refusing to derive from a surface that won't date itself");
const lastRefreshed = lr[1].trim();

// ── the table ────────────────────────────────────────────────────────────────
const lines = md.split("\n").filter((l) => l.startsWith("|"));
if (lines.length < 3) die("no table found (need header + separator + >=1 row)");
const cells = (l) => l.replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
const header = cells(lines[0]);
// The board narrowed from 5 columns (…| Move | Track) to 4 (…| Move) on 2026-07-17,
// per the channel law (boards hold only homeless loops; the dedicated issue column
// was dropped since most rows have no GitHub object). Accept either shape; the
// issue number, when a row has one, is recovered from the loop/surface text below.
const NCOL = header.length;
if (NCOL !== 4 && NCOL !== 5) die(`header has ${NCOL} columns, expected 4 (Loop | owed | surface | Move) or 5 (…| Track)`);
const rows = lines.slice(2).map((l, i) => {
  const c = cells(l);
  if (c.length !== NCOL) die(`row ${i + 1} has ${c.length} columns, expected ${NCOL}: ${l.slice(0, 60)}…`);
  return { loop: c[0], detail: c[1], surface: c[2], move: c[3], track: c[4] || "" };
});
if (rows.length === 0) die("table has zero rows");

// ── inline formatting: escape FIRST, then a small controlled subset ──────────
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const inline = (s) => {
  let h = esc(s);
  h = h.replace(/`([^`]+)`/g, "<code>$1</code>");
  h = h.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  h = h.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  h = h.replace(/\*([^*]+)\*/g, "<i>$1</i>");
  // bare #NNN -> issue link (skip ones already inside a written link's text)
  h = h.replace(/(^|[^"\w>])#(\d{2,4})\b(?![^<]*<\/a>)/g, `$1<a href="${ISSUES}$2" target="_blank" rel="noopener">#$2</a>`);
  return h;
};
const plain = (s) => s.replace(/\*\*|\*|`/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

// ── move glyph -> whose_move ─────────────────────────────────────────────────
const whoseMove = (m) =>
  m.includes("👤") ? "keemin" : m.includes("⏳") ? "theirs" : m.includes("✓") ? "closed" : "wright";

const generatedAt = new Date().toISOString();

const boardData = {
  source: "wright's own board (memory/topics/postmark-open-loops.md — the operator's drafting table, resident-private)",
  authored_by: "the operator round (this island is machine-derived — edit the .md, never this)",
  last_refreshed: lastRefreshed,
  generated_at: generatedAt,
  legend: "⟳ mine · ⏳ theirs (slow-mail) · 👤 Keemin · ✓ closed",
  rows: rows.map((r) => ({
    loop_html: inline(r.loop),
    detail_html: inline(r.detail),
    move: r.move,
    whose_move: whoseMove(r.move),
    track: plain(r.track),
  })),
};

const windowState = {
  handle: "wright",
  hand_set: generatedAt.slice(0, 10),
  composed: "derived-from-open-loops.md",
  scope: "postmark-operator-lane",
  generated_at: generatedAt,
  open_items: rows
    .filter((r) => whoseMove(r.move) !== "closed")
    .map((r) => {
      const num = /#(\d{2,4})/.exec(r.track) || /#(\d{2,4})/.exec(r.loop) || /#(\d{2,4})/.exec(r.surface);
      const id = num ? `postmark#${num[1]}` : plain(r.loop).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
      let title = `${plain(r.loop)} — ${plain(r.detail)}`;
      if (title.length > 220) title = title.slice(0, 219) + "…";
      return { id, title, whose_move: whoseMove(r.move) };
    }),
};

// ── splice both islands into the pane ────────────────────────────────────────
let html = readFileSync(WINDOW, "utf8");
const splice = (id, json) => {
  const re = new RegExp(`(<script[^>]*\\bid="${id}"[^>]*>)[\\s\\S]*?(</script>)`);
  if (!re.test(html)) die(`pane has no <script id="${id}"> island — the shell drifted; fix the pane first`);
  html = html.replace(re, `$1\n${JSON.stringify(json, null, 2)}\n  $2`);
};
splice("board-data", boardData);
splice("window-state", windowState);

if (DRY) {
  console.log(JSON.stringify({ dry: true, rows: rows.length, open_items: windowState.open_items.length, last_refreshed: lastRefreshed }));
  process.exit(0);
}
writeFileSync(WINDOW, html);
console.log(JSON.stringify({ derived: true, rows: rows.length, open_items: windowState.open_items.length, last_refreshed: lastRefreshed, generated_at: generatedAt }));
