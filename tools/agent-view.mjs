#!/usr/bin/env node
// agent-view.mjs — WHAT THE AGENT SEES, offline: the bug lifecycle, step by step.
//
//   node tools/agent-view.mjs --out <file.html>
//
// Keemin, 2026-09-28 (the Posts project, § Acceptance for phase 2): "I really
// want to make sure we uphold a high bar when it comes to context engineering
// for our residents so that the tools teach the residents." This writes ONE
// self-contained HTML page that shows, for each step of a bug's life — post as
// yourself, post on a resident's behalf, amend, each advance, each refusal —
// exactly what a resident's agent is handed:
//
//   · the MCP tool it calls (`town`) and that tool's description;
//   · the act's card (its blurb, its fields and their descriptions) and the
//     description of the flat verb the act dispatches to;
//   · the HTTP twin (POST /town/apex with the same envelope, or the GET);
//   · the answer, whole — every refusal's sentence (`defect`) and its next step
//     (`hint`) included;
//   · the answer's byte cost against the foyer's bound (8,192 B, the
//     connector's bare-answer ceiling, test/foyer-shrink.test.mjs F5c).
//
// ── FROM THE REPO AT A COMMIT: NO BOX, NO NETWORK ───────────────────────────
//
// Every answer is the office's own dispatcher (`src/mcp.mjs § callTool`, the
// function the MCP door and POST /town/apex both call) over the office's own
// code at this checkout. The store is the suites' in-memory pen
// (test/acts-pen-stub.mjs) with the posts table beside it, so the acts and rows
// are what the real pen writes, and nothing about Postgres is claimed. The
// clock is pinned, so the page is the same bytes at the same commit, and a
// description that changed shows up as a diff in review.

import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

/** The foyer's bound: the connector's bare answer stays under it (foyer-shrink F5c). */
export const FOYER_BOUND = 8_192;
/** The pinned clock: 2026-09-29, 16:00 UTC. */
export const PINNED_NOW = Date.parse("2026-09-29T16:00:00Z");

const KEY = (h) => ({ household: h, handles: new Set([h]) });
const WRIGHT = KEY("wright");
const ERRANT = KEY("errant");
const FINN = KEY("finn");

const BUG = { class: "bug", title: "The door sticks", body: "The front door of the post office does not open on the second try: it opens once, then sticks until the next crossing." };
const ID = "errant/the-door-sticks";

/** The steps, in the order a bug lives them. `kind` is "step" or "refusal". */
export const STEPS = [
  { kind: "step", title: "Read the post card", who: ERRANT, env: { read: "post" }, note: "Any act name reads back its card. This is how an agent learns what post takes before it posts." },
  { kind: "step", title: "Post a bug as yourself", who: ERRANT, env: { do: "post", args: { ...BUG, steps: "Open the door, close it, open it again.", record: "https://postmark.town/api/release" } } },
  { kind: "refusal", title: "Stake on it at post", who: ERRANT, env: { do: "post", args: { ...BUG, title: "Another door", stamps: 3 } }, note: "stamps is the idea lane's escrow; a bug takes none." },
  { kind: "refusal", title: "Stake on it at the stake door", who: FINN, env: { do: "stake", args: { mark: ID, stamps: 2 } } },
  { kind: "refusal", title: "A body over 600 characters", who: ERRANT, env: { do: "post", args: { ...BUG, title: "Long", body: "x".repeat(601) } } },
  { kind: "refusal", title: "An issue off the town's repos", who: ERRANT, env: { do: "post", args: { ...BUG, title: "Linked", issue: "https://github.com/someone/else/issues/1" } } },
  { kind: "step", title: "A hand posts on a resident's behalf", who: WRIGHT, env: { do: "post", args: { class: "bug", title: "The map drifts", body: "The map drifts one cell east after every settlement.", for: "ada" } } },
  { kind: "refusal", title: "A resident tries to post for someone else", who: ERRANT, env: { do: "post", args: { class: "bug", title: "Not mine", body: "x", for: "ada" } } },
  { kind: "step", title: "The reporter amends it", who: ERRANT, env: { do: "amend", args: { post: ID, steps: "Open it, close it, open it again: it sticks the second time." } } },
  { kind: "refusal", title: "A resident who is not a hand advances it", who: FINN, env: { do: "advance", args: { post: ID, to: "confirmed" } } },
  { kind: "step", title: "Advance: confirmed (the reporter is credited)", who: WRIGHT, env: { do: "advance", args: { post: ID, to: "confirmed" } } },
  { kind: "refusal", title: "The reporter amends after confirmed", who: ERRANT, env: { do: "amend", args: { post: ID, title: "The door sticks, twice" } } },
  { kind: "refusal", title: "Advance to reproduced without a credit", who: WRIGHT, env: { do: "advance", args: { post: ID, to: "reproduced" } } },
  { kind: "step", title: "Advance: reproduced", who: WRIGHT, env: { do: "advance", args: { post: ID, to: "reproduced", credit: "finn" } } },
  { kind: "refusal", title: "Advance backwards", who: WRIGHT, env: { do: "advance", args: { post: ID, to: "confirmed" } } },
  { kind: "refusal", title: "A side exit after confirmed", who: WRIGHT, env: { do: "advance", args: { post: ID, to: "not-a-bug" } } },
  { kind: "step", title: "Advance: diagnosed", who: WRIGHT, env: { do: "advance", args: { post: ID, to: "diagnosed", credit: "finn" } } },
  { kind: "refusal", title: "Advance to briefed without a grade", who: WRIGHT, env: { do: "advance", args: { post: ID, to: "briefed", credit: "finn" } } },
  { kind: "step", title: "Advance: briefed (light)", who: WRIGHT, env: { do: "advance", args: { post: ID, to: "briefed", credit: "finn", grade: "light" } } },
  { kind: "refusal", title: "Advance to fixed without a size", who: WRIGHT, env: { do: "advance", args: { post: ID, to: "fixed", credit: "finn" } } },
  { kind: "step", title: "Advance: fixed (M)", who: WRIGHT, env: { do: "advance", args: { post: ID, to: "fixed", credit: "finn", size: "M" } } },
  { kind: "refusal", title: "Close a bug", who: WRIGHT, env: { do: "close", args: { post: ID } } },
  { kind: "step", title: "Advance: shipped", who: WRIGHT, env: { do: "advance", args: { post: ID, to: "shipped" } } },
  { kind: "refusal", title: "Advance a finished bug", who: WRIGHT, env: { do: "advance", args: { post: ID, to: "shipped" } } },
  { kind: "step", title: "A hand jumps a bug: reported → diagnosed", who: WRIGHT, env: { do: "advance", args: { post: "ada/the-map-drifts", to: "diagnosed", credit: "finn" } }, note: "A skipped stage pays nothing; the receipt says which." },
  { kind: "step", title: "Read the bug posts", who: null, env: { read: "posts", args: { class: "bug" } } },
];

// ── the posts table, in memory (the suites' shape: test/bug-post.test.mjs) ──
function postsTable() {
  const posts = new Map();
  const PC = ["id", "class", "title", "body", "author", "household", "place_mark", "place_x", "place_y",
    "starts", "ends", "state", "fields", "revised", "posted_act", "last_act"];
  const asJson = (v) => (typeof v === "string" ? JSON.parse(v) : v);
  const copy = (r) => ({ ...r, fields: { ...r.fields } });
  const byClass = (cls) => [...posts.values()].filter((r) => r.class === cls).sort((a, b) => a.id.localeCompare(b.id)).map(copy);
  return [
    [/^INSERT INTO posts/i, (q, p) => { const r = Object.fromEntries(PC.map((k, i) => [k, p[i]])); r.fields = asJson(r.fields); posts.set(p[0], r); return { rows: [], rowCount: 1 }; }],
    [/^UPDATE posts SET/i, (q, p) => { Object.assign(posts.get(p[0]), { title: p[1], body: p[2], state: p[8], fields: asJson(p[9]), revised: p[10], last_act: p[11] }); return { rows: [], rowCount: 1 }; }],
    [/FROM posts WHERE id = \$1 AND class = \$2$/i, (q, p) => { const r = posts.get(p[0]); const hit = r && r.class === p[1]; return { rows: hit ? [copy(r)] : [], rowCount: hit ? 1 : 0 }; }],
    [/^SELECT id, state, ends FROM posts WHERE id LIKE \$1$/i, (q, p) => { const pre = p[0].replace(/%$/, ""); const rows = [...posts.values()].filter((r) => r.id.startsWith(pre)); return { rows, rowCount: rows.length }; }],
    [/^SELECT id, class, title, author, household, starts, ends, fields, state, last_act FROM posts WHERE class = \$1 ORDER BY id$/i, (q, p) => { const rows = byClass(p[0]); return { rows, rowCount: rows.length }; }],
    [/^SELECT post, handle, state FROM responses WHERE post = ANY\(\$1\) ORDER BY post, handle$/i, () => ({ rows: [], rowCount: 0 })],
  ];
}

const bytes = (v) => Buffer.byteLength(JSON.stringify(v));
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pretty = (v) => esc(JSON.stringify(v, (k, x) => (x instanceof Set ? [...x] : x), 2));

/** Drive every step through the office's own dispatcher. Returns the page's data. */
export async function collect() {
  // The office, pointed at the in-memory record, with the apex on; the clock pinned.
  Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: "postgres://agent-view-stub/none", WORLD_APEX: "1" });
  Date.now = () => PINNED_NOW;
  const { installActsPen, uninstallActsPen } = await import(pathToFileURL(resolve(ROOT, "test", "acts-pen-stub.mjs")).href);
  const { callTool, toolList, TOOLS } = await import("../src/mcp.mjs");
  const { townDispatchToolFor, TOWN_READS } = await import("../src/town-apex.mjs");
  const { planStages, renderPlan, storeFacts } = await import("./bug-stage-plan.mjs");

  const pen = installActsPen({ households: [{ slug: "the-harbor", ord: 1, residents: ["errant", "ada"] }], also: postsTable() });
  try {
    const town = toolList().find((t) => t.name === "town");
    const flat = (name) => TOOLS.find((t) => t.name === name) ?? null;
    const out = [];
    for (const s of STEPS) {
      const answer = await callTool("town", s.env, { key: s.who, clone: null });
      const verb = s.env.do ? townDispatchToolFor(s.env.do) : TOWN_READS[s.env.read]?.tool ?? townDispatchToolFor(s.env.read);
      const status = answer?.error === "bounce" ? (answer.code ?? 422) : 200;
      out.push({ ...s, who: s.who ? [...s.who.handles][0] : null, answer, verb, flat: flat(verb), status, bytes: bytes(answer),
        refused: answer?.error === "bounce" });
    }
    const facts = await storeFacts();
    const rows = planStages({ acts: facts.acts, houseOf: (h) => facts.houses.get(h) ?? `solo:${h}`, isMeep: () => false, paid: new Set() });
    return { town, steps: out, plan: renderPlan(rows), acts: pen.rows().length };
  } finally { uninstallActsPen(); }
}

function commitOf() {
  try {
    const sha = execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["-C", ROOT, "status", "--porcelain", "--", "src", "tools", "test"], { encoding: "utf8" }).trim() !== "";
    return `${sha}${dirty ? " (with uncommitted changes in src/, tools/ or test/)" : ""}`;
  } catch { return "unknown (not a git checkout)"; }
}

const twin = (s) => (s.env.do
  ? `POST /town/apex\nAuthorization: Bearer &lt;your key&gt;\n\n${esc(JSON.stringify(s.env))}`
  : `GET /town/apex?read=${encodeURIComponent(s.env.read)}${s.env.args ? `&amp;args=${esc(encodeURIComponent(JSON.stringify(s.env.args)))}` : ""}${s.env.read === "posts" && s.env.args?.class ? `\n(or GET /posts?class=${esc(s.env.args.class)})` : ""}`);

/** The card's fields, as world-apex.mjs § actionFields shapes them: `{ name: { type, description, enum?, required? } }`. */
function fieldsTable(card) {
  const entries = Object.entries(card?.fields ?? {});
  if (!entries.length) return "";
  const rows = entries.map(([name, f]) => `<tr><td><code>${esc(name)}</code>${f.required ? " <b>required</b>" : ""}</td><td>${esc(f.type ?? "")}${f.enum ? ` (${esc(f.enum.join(", "))})` : ""}</td><td>${esc(f.description ?? "")}</td></tr>`).join("");
  return `<table><thead><tr><th>field</th><th>type</th><th>description</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** The page, self-contained: no script, no font, no request. */
export function render({ town, steps, plan, acts }, { commit = commitOf() } = {}) {
  const meter = (n) => {
    const pct = Math.min(100, Math.round((n / FOYER_BOUND) * 100));
    return `<span class="bytes ${n > FOYER_BOUND ? "over" : ""}">${n.toLocaleString("en-US")} B · ${pct}% of the foyer's ${FOYER_BOUND.toLocaleString("en-US")} B</span><span class="bar"><i style="width:${pct}%"></i></span>`;
  };
  const toc = steps.map((s, i) => `<li class="k-${s.kind}"><a href="#s${i + 1}">${esc(s.title)}</a>${s.refused ? " <em>refused</em>" : ""}</li>`).join("");
  const sections = steps.map((s, i) => {
    const card = s.answer?.card ?? (s.env.read && s.answer?.card) ?? null;
    const refusal = s.refused ? `<div class="refusal"><p class="defect">${esc(s.answer.defect)}</p><p class="hint"><b>next step (hint):</b> ${esc(s.answer.hint ?? "")}</p></div>` : "";
    const receipt = !s.refused && s.answer?.result?.receipt ? `<p class="receipt">${esc(s.answer.result.receipt)}</p>` : "";
    return `<section id="s${i + 1}" class="k-${s.kind}${s.refused ? " refused" : ""}">
<h2>${i + 1}. ${esc(s.title)} <small>${s.refused ? `refused · ${s.status}` : `answered · ${s.status}`}${s.who ? ` · as ${esc(s.who)}` : " · no key"}</small></h2>
${s.note ? `<p class="note">${esc(s.note)}</p>` : ""}
<h3>The call</h3><pre>town ${esc(JSON.stringify(s.env))}</pre>
<h3>The HTTP twin</h3><pre>${twin(s)}</pre>
${refusal}${receipt}
<h3>The answer ${meter(s.bytes)}</h3><details><summary>the whole answer</summary><pre>${pretty(s.answer)}</pre></details>
${card ? `<h3>The act's card: <code>${esc(card.act)}</code> → <code>${esc(card.dispatches_to)}</code></h3><p>${esc(card.blurb)}</p>${fieldsTable(card)}` : ""}
${s.flat ? `<details><summary>the flat verb <code>${esc(s.flat.name)}</code>'s description (${bytes(s.flat.description).toLocaleString("en-US")} B)</summary><p>${esc(s.flat.description)}</p></details>` : ""}
</section>`;
  }).join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>What the agent sees: bugs</title>
<style>
:root { --bg:#fbfaf7; --ink:#1d1b16; --soft:#6b6558; --line:#e3ded2; --no:#9c2f1f; --nobg:#fbeeea; --ok:#2f6b3a; --bar:#c9c1ad; --link:#1f4f8a; }
@media (prefers-color-scheme: dark) { :root { --bg:#16140f; --ink:#ece7da; --soft:#a39b88; --line:#332f26; --no:#f0947f; --nobg:#2c1a15; --ok:#8fcf99; --bar:#4a4436; --link:#9cc3f0; } }
a { color:var(--link); }
body { background:var(--bg); color:var(--ink); font:15px/1.5 system-ui, sans-serif; margin:0 auto; max-width:980px; padding:24px 16px 80px; }
h1 { font-size:26px; margin:0 0 4px; } h2 { font-size:18px; margin:0 0 8px; } h3 { font-size:13px; text-transform:uppercase; letter-spacing:.04em; color:var(--soft); margin:16px 0 6px; }
small { color:var(--soft); font-weight:normal; } .meta { color:var(--soft); }
section { border-top:1px solid var(--line); padding:20px 0; } section.refused h2 small { color:var(--no); }
pre { background:rgba(127,127,127,.08); border:1px solid var(--line); border-radius:6px; padding:10px; overflow-x:auto; white-space:pre-wrap; word-break:break-word; font-size:12.5px; }
.refusal { background:var(--nobg); border-left:3px solid var(--no); padding:8px 12px; border-radius:4px; } .defect { font-weight:600; margin:0 0 4px; } .hint { margin:0; }
.receipt { border-left:3px solid var(--ok); padding:4px 12px; }
.bytes { font-weight:normal; text-transform:none; letter-spacing:0; margin-left:8px; } .bytes.over { color:var(--no); font-weight:600; }
.bar { display:inline-block; width:120px; height:6px; background:var(--line); border-radius:3px; margin-left:8px; vertical-align:middle; } .bar i { display:block; height:6px; background:var(--bar); border-radius:3px; }
table { border-collapse:collapse; width:100%; font-size:13px; } td, th { border-bottom:1px solid var(--line); padding:4px 6px; text-align:left; vertical-align:top; }
ol.toc { columns:2; font-size:13.5px; } ol.toc li.k-refusal a { color:var(--no); } em { color:var(--no); font-style:normal; font-size:12px; }
@media (max-width:640px) { ol.toc { columns:1; } }
</style></head><body>
<h1>What the agent sees: the bug lifecycle</h1>
<p class="meta">Generated offline from postmark-office at <code>${esc(commit)}</code>, by <code>node tools/agent-view.mjs</code>. Every answer is the office's own dispatcher (<code>callTool("town", …)</code>, which the MCP door and <code>POST /town/apex</code> both call) over an in-memory record; the clock is pinned to ${new Date(PINNED_NOW).toISOString()}. ${acts} acts were written.</p>
<h2>The MCP tool: <code>${esc(town?.name ?? "town")}</code></h2>
<p class="meta">This is what the agent holds in its tool list for every call below (${bytes(town?.description ?? "").toLocaleString("en-US")} B of description, ${bytes(town?.inputSchema ?? {}).toLocaleString("en-US")} B of schema).</p>
<details><summary>the description</summary><p>${esc(town?.description ?? "")}</p></details>
<details><summary>the input schema</summary><pre>${pretty(town?.inputSchema ?? {})}</pre></details>
<h2>The steps</h2><ol class="toc">${toc}</ol>
${sections}
<section><h2>The reviewed pass: the stage plan these acts produce</h2>
<p class="note">The advances mint nothing. <code>node tools/bug-stage-plan.mjs --town &lt;clone&gt;</code> prints this; Wright reads it, then runs it with <code>--apply</code>. The meep law and "already paid" come from the town's ledger, which this offline page does not read, so here nobody is a meep and nothing is paid yet.</p>
<pre>${esc(plan)}</pre></section>
</body></html>
`;
}

export async function main(argv = process.argv.slice(2)) {
  const i = argv.indexOf("--out");
  const out = i === -1 ? null : argv[i + 1];
  if (!out) { console.error("agent-view: --out <file.html> is required (the page is written there and nowhere else)"); return 2; }
  const data = await collect();
  const html = render(data);
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(out, html);
  const refused = data.steps.filter((s) => s.refused).length;
  const over = data.steps.filter((s) => s.bytes > FOYER_BOUND);
  console.log(`agent-view: ${data.steps.length} steps (${refused} refusals) → ${out} · ${Buffer.byteLength(html).toLocaleString("en-US")} B`
    + `${over.length ? ` · ${over.length} answer(s) over the foyer's bound: ${over.map((s) => s.title).join("; ")}` : " · every answer under the foyer's bound"}`);
  return 0;
}

const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) process.exitCode = await main();
