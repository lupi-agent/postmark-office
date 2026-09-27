#!/usr/bin/env node
// ops-index.mjs — the postmark.town/ops/ hub.
//
// The hub used to be a hand-written Astro page in the SITE repo: four cards with
// prose on them, no numbers, and no economy card at all (it shipped 2026-08-10
// and nothing linked to it). A directory of links cannot tell you that one of
// the instruments behind it has stopped — and /ops/world/ had been frozen since
// 2026-07-31 without the hub showing a mark on it.
//
// So the hub is a generated page now, a sibling of the five it points at: one
// card per dashboard carrying a live headline number, a 14-day sparkline, and a
// FRESHNESS chip read from that dashboard's own generated_at. A card whose JSON
// twin is missing, unparseable or stale says so in red and still links through.
// The desk is a console, not an instrument, so its card carries no number.
//
// Sources: each dashboard's data.json twin, already published beside its page —
// this reads the contract they all already keep, and computes nothing of its own.
//
// Output: $OPS_ROOT/index.html (+ data.json — the freshness roll-up, so a
// monitor can poll one file instead of four).
//
// Ordering note for the box: this must run AFTER its five siblings, so install
// it as /etc/cron.hourly/zz-postmark-ops-index (run-parts runs alphabetically).
// Reading a sibling's twin one cycle late is not fatal — the chip reports the
// twin's own generated_at, not this run's — but out of order it is always stale
// by an hour for no reason.
//
// Zero dependencies. Node 20+.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as V from "./lib/ops-viz.mjs";

const OPS_ROOT = process.env.OPS_ROOT || "/var/www/postmark-ops";
const { esc, comma, compact } = V;

// The four twins write their timestamp in three different shapes; a hub that
// only understood one of them would report the others as broken.
//   traffic  "2026-08-11 14:04Z"        git, activity  "2026-08-11T13:55:38.203Z"
//   economy/world  "2026-08-11 14:08 UTC"
function parseStamp(s) {
  if (!s) return null;
  const t = Date.parse(String(s).replace(/ UTC$/, "Z").replace(/^(\d{4}-\d{2}-\d{2}) /, "$1T"));
  return Number.isFinite(t) ? t : null;
}
const lastN = (obj, n, pick = (v) => v) => {
  const keys = Object.keys(obj || {}).sort().slice(-n);
  return keys.map((k) => Number(pick(obj[k])) || 0);
};

// The window the cards read. Each twin publishes its own `recent` block; these
// two are the fallback for a twin written before that block existed, so a hub
// deployed ahead of a generator shows a real number rather than a dash.
const WIN = V.windows(7);
const sumWindow = (map, pick) => WIN.sum(map, pick);
const deltaWord = (w) => {
  if (!w || (!w.cur && !w.prev)) return "quiet in both windows";
  if (!w.prev) return "nothing in the prior week";
  const change = (w.cur - w.prev) / w.prev;
  if (w.cur === w.prev) return "level with last week";
  return `${w.cur > w.prev ? "▲" : "▼"} ${Math.abs(change * 100) < 10 ? (Math.abs(change) * 100).toFixed(1) : Math.round(Math.abs(change) * 100)}% vs last week`;
};

function read(name) {
  const p = join(OPS_ROOT, name, "data.json");
  if (!existsSync(p)) return { missing: `no data.json at ${p}` };
  try { return { data: JSON.parse(readFileSync(p, "utf8")) }; }
  catch (e) { return { missing: `unreadable data.json (${e.message.slice(0, 60)})` }; }
}

// ── the shelf ────────────────────────────────────────────────────────────────
// Each entry turns its dashboard's twin into a headline + a trend. `read` is
// only called for the generated ones; the desk has no twin by design.
// RECENCY FIRST (2026-08-11, Keemin: "tweak the focus to be more on
// latest/fresh activity, not so much on lifetime totals"). Every card headline
// is now a WINDOW — what moved in the last seven days — with the lifetime
// figure kept on the sub-line, where it is still one glance away. Each twin
// publishes its own `recent` block, so the hub reads the window rather than
// re-deriving one; a twin from before that block existed falls back to the
// by-day maps rather than showing a blank card.
const SHELF = [
  {
    slug: "traffic", href: "traffic/", emblem: "⇅", kind: "Dashboard", title: "Traffic",
    line: "Who is knocking: requests by day and by UA class, the doorstep, the bulletin, the office door, GitHub views and clones.",
    read: (d) => {
      const r = d.recent ?? {};
      const w = r.requests ?? sumWindow(d.days, (v) => v.total);
      const allTime = Object.values(d.days || {}).reduce((s, v) => s + (v.total || 0), 0);
      return {
        stamp: d.generated,
        value: compact(w.cur), unit: `requests in the last ${r.window_days ?? 7} days`,
        sub: `${deltaWord(w)} · ${compact(allTime)} across ${Object.keys(d.days || {}).length} logged days`,
        spark: lastN(d.days, 14, (v) => v.total),
      };
    },
  },
  {
    slug: "git", href: "git/", emblem: "⎇", kind: "Dashboard", title: "Git activity",
    line: "What landed: merges the witness made unattended, merges made by hand, and commits that reached main without a PR — then the funnel, the defect trend, and whose move the queue is waiting on.",
    // LANDED, not queued (2026-08-11, Keemin: "im less interested in current
    // open prs and more the auto merges and commits that took place"). The card
    // headline is what went in; "open now" demotes to the sub-line, where it is
    // still the to-do the operator came for.
    read: (d) => {
      const r = d.recent ?? {};
      const merged = r.merged ?? sumWindow(d.merge_actors, (m) => Object.values(m || {}).reduce((a, b) => a + b, 0));
      const opened = r.opened ?? sumWindow(d.funnel, (v) => v.opened);
      const auto = r.merged_by_lane?.witness?.cur;
      return {
        stamp: d.generated_at,
        value: comma(merged.cur), unit: `merged in the last ${r.window_days ?? 7} days`,
        sub: `${deltaWord(merged)}${auto == null ? "" : ` · ${comma(auto)} by the witness`}`
          + ` · ${comma(opened.cur)} opened · ${comma(d.totals?.open ?? 0)} open now`,
        spark: lastN(d.merge_actors, 14, (m) => Object.values(m || {}).reduce((a, b) => a + b, 0)),
        // the queue can still raise the alarm from here even though it is no
        // longer the headline
        flag: (d.queue?.neverRan?.length ?? 0) ? { cls: "red", text: `${d.queue.neverRan.length} PR(s) with no witness comment` }
          : (d.totals?.open ?? 0) > 25 ? { cls: "warn", text: `${d.totals.open} open in the queue` } : null,
      };
    },
  },
  {
    slug: "economy", href: "economy/", emblem: "✦", kind: "Dashboard", title: "The economy",
    line: "What moved this week: minting by household, stamps changing hands, what got backed — with the equity curve and supply kept as the long view.",
    read: (d) => {
      const r = d.recent ?? {};
      const w = r.minted ?? sumWindow(d.issuance?.by_day, (v) => Object.values(v || {}).reduce((a, b) => a + b, 0));
      return {
        stamp: d.generated_at,
        value: comma(w.cur), unit: `stamps minted in the last ${r.window_days ?? 7} days`,
        sub: `${deltaWord(w)} · ${comma(r.earning_households ?? 0)} households earning · ${comma(d.equity?.M ?? 0)} all time`,
        spark: lastN(d.issuance?.by_day, 14, (v) => Object.values(v || {}).reduce((a, b) => a + b, 0)),
        flag: d.supply?.clean === false ? { cls: "red", text: "supply guard RED" } : null,
      };
    },
  },
  {
    slug: "world", href: "world/", emblem: "◈", kind: "Dashboard", title: "The World",
    line: "Who is staking and on what, who is building, crossing health against the twice-daily law, the draft census, and door traffic.",
    read: (d) => {
      const r = d.recent ?? {};
      const w = r.marks ?? sumWindow(d.marks?.per_day_14, (v) => v);
      return {
        stamp: d.generated_at,
        value: comma(w.cur), unit: `marks left in the last ${r.window_days ?? 7} days`,
        sub: `${deltaWord(w)} · ${comma(r.staked?.cur ?? 0)}✦ staked · ${comma(d.marks?.total ?? 0)} marks all time`,
        spark: lastN(d.marks?.per_day_14, 14),
        // crossing health is about the FERRY, not about the mark count — so it
        // rides its own chip rather than tinting a number it does not describe
        flag: d.crossing?.status === "ok" ? null
          : { cls: d.crossing?.status === "warn" ? "warn" : "red", text: `crossing ${d.crossing?.status ?? "unknown"}` },
      };
    },
  },
  {
    // WHO IS STILL HERE (POS-216, 2026-09-23 — Keemin: "it's hard to know how
    // many of them (and how many households) are still actually active"). The
    // headline is distinct RESIDENTS who wrote on the public record this week;
    // households (acted or read) ride the sub-line. Reads never appear per
    // household here — the twin publishes them only as buckets.
    slug: "activity", href: "activity/", emblem: "◉", kind: "Dashboard", title: "Who is active",
    line: "How many residents and households are still here: who wrote on the public record, which households called the office, new against returning, and retention by join month.",
    read: (d) => {
      const r = d.recent ?? {};
      const w = r.acted_residents ?? { cur: 0, prev: 0 };
      return {
        stamp: d.generated_at,
        value: comma(w.cur), unit: `residents acted in the last ${r.window_days ?? 7} days`,
        sub: `${deltaWord(w)} · ${comma(r.active_households?.cur ?? 0)} households active · ${comma(d.lifetime?.residents ?? 0)} residents lifetime`,
        spark: (r.spark14 ?? []).map((x) => Number(x) || 0),
      };
    },
  },
  {
    // ONE card for the graph, its lenses as deep links INSIDE it. This was
    // three peer cards (console + two Lens cards), which read as three
    // different pages of the same rank — Keemin, 2026-08-17: "I'm not sure why
    // we have 3 different links to the graphs." The lenses are ways of LOOKING
    // at one page (the page's own ruling), and the hub now says so with its
    // shape: one door, four handles.
    slug: null, href: "graph/", emblem: "⌗", kind: "Console", title: "The world graph",
    line: "world.db as one picture — every node and edge, the standing invariants painted on in red, filters over the whole store, and the law's lenses as ways of looking at the one page.",
    lenses: [
      { href: "graph/", label: "standing" },
      { href: "graph/?paint=ideal", label: "LOGOS adherence" },
      { href: "graph/?paint=works", label: "the keeping works" },
      { href: "graph/?paint=works&view=works", label: "the board — asks only" },
    ],
  },
  {
    slug: null, href: "desk/", emblem: "✒", kind: "Console", title: "The Principal's Desk",
    line: "Gift stamps to a resident, minted with the town's own pen. A console, not an instrument — it has no reading to show.",
  },
];

// ── build the cards ──────────────────────────────────────────────────────────
const now = Date.now();
const roll = {};
const cards = SHELF.map((s) => {
  if (!s.slug) {
    // A card with lens links cannot be one big <a> — nested anchors are not
    // HTML. The door stays the whole upper card; the lenses ride a pill row
    // of their own below it.
    if (s.lenses) {
      return `<div class="card"><a class="c-door" href="${s.href}"><span class="c-em">${s.emblem}</span><div class="c-body">`
        + `<span class="c-kind">${esc(s.kind)}</span><span class="c-title">${esc(s.title)}</span>`
        + `<span class="c-line">${esc(s.line)}</span><span class="c-open">open →</span></div></a>`
        + `<div class="c-lenses">${s.lenses.map((l) => `<a href="${l.href}">${esc(l.label)}</a>`).join("")}</div></div>`;
    }
    return `<a class="card" href="${s.href}"><span class="c-em">${s.emblem}</span><div class="c-body">`
      + `<span class="c-kind">${esc(s.kind)}</span><span class="c-title">${esc(s.title)}</span>`
      + `<span class="c-line">${esc(s.line)}</span><span class="c-open">open →</span></div></a>`;
  }
  const { data, missing } = read(s.slug);
  let v = null, err = missing;
  if (data) { try { v = s.read(data); } catch (e) { err = `twin present but unreadable (${e.message.slice(0, 60)})`; } }

  const ts = v ? parseStamp(v.stamp) : null;
  const ageH = ts == null ? null : (now - ts) / 36e5;
  // Hourly cron: under 3h is normal, a missed cycle or two is amber, past a day
  // the generator has stopped and the numbers on the card are a museum piece.
  const fresh = err ? "red" : ageH == null ? "red" : ageH < 3 ? "ok" : ageH < 24 ? "warn" : "red";
  const freshText = err ? "NO DATA" : ageH == null ? "unreadable timestamp"
    : ageH < 1.5 ? `fresh · ${Math.round(ageH * 60)}m ago`
    : ageH < 24 ? `${ageH.toFixed(1)}h old`
    : `STALE · ${Math.floor(ageH / 24)}d old`;
  roll[s.slug] = { generated_at: v?.stamp ?? null, age_hours: ageH == null ? null : Number(ageH.toFixed(2)), freshness: fresh, headline: v ? `${v.value} ${v.unit}` : null, error: err ?? null };

  const readingCls = v?.status ? ` v-${v.status}` : "";
  // The card says what happened in a phrase; the path and the parser's own words
  // go to the roll-up, where an operator can read them without a card reflowing.
  const reading = err
    ? `<span class="c-val v-red">—</span><span class="c-unit">${esc(err.startsWith("no data.json") ? "no data.json twin — this generator has never run here" : "data.json unreadable")}</span>`
    : `<span class="c-val${readingCls}">${esc(v.value)}</span><span class="c-unit">${esc(v.unit)}</span>`
      + `<span class="c-sub">${esc(v.sub)}</span>`
      + (v.spark?.some((x) => x) ? V.sparkline(v.spark, { w: 150, h: 30, title: "last 14 days" }) : "");

  return `<a class="card" href="${s.href}"><span class="c-em">${s.emblem}</span><div class="c-body">`
    + `<span class="c-kind">${esc(s.kind)}</span><span class="c-title">${esc(s.title)}</span>`
    + `<span class="c-line">${esc(s.line)}</span>`
    + `<div class="c-read">${reading}</div>`
    + `<div class="c-chips"><span class="chip ${fresh}">${esc(freshText)}</span>`
    + `${v?.flag ? `<span class="chip ${v.flag.cls}">${esc(v.flag.text)}</span>` : ""}</div></div></a>`;
});

const stale = Object.entries(roll).filter(([, r]) => r.freshness !== "ok");
const banner = stale.length
  ? `<p class="alert">${stale.length} of ${Object.keys(roll).length} instruments ${stale.length === 1 ? "is" : "are"} not fresh: `
    + stale.map(([k, r]) => `<b>${esc(k)}</b> (${r.error ? "no data" : r.age_hours >= 24 ? `${Math.floor(r.age_hours / 24)}d old` : `${r.age_hours}h old`})`).join(", ")
    + `. An hourly generator that has stopped leaves a page that still looks like a reading.</p>`
  : `<p class="ok-line">All ${Object.keys(roll).length} instruments regenerated within the hour.</p>`;

const EXTRA = `
.shelf{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:.9rem;margin:1.1rem 0 0}
.card{display:flex;flex-direction:column;background:var(--panel);border:1px solid var(--line);border-radius:10px;
 overflow:hidden;text-decoration:none;color:inherit;transition:border-color .15s ease,transform .15s ease}
.card:hover{border-color:var(--gold);transform:translateY(-2px)}
.card:focus-visible{outline:2px solid var(--gold);outline-offset:3px}
/* the emblems are symbol codepoints; a monospace face renders half of them as
   tofu or as a squashed glyph, so they ask for the OS symbol faces first —
   local fonts only, nothing fetched */
.c-em{display:grid;place-items:center;height:64px;background:rgba(232,196,139,.06);color:rgba(232,196,139,.65);
 font-size:1.9rem;line-height:1;font-family:"Segoe UI Symbol","Apple Symbols","Noto Sans Symbols 2",system-ui,sans-serif}
.c-body{display:flex;flex-direction:column;gap:.28rem;padding:.8rem .9rem 1rem;flex:1}
.c-kind{font-size:.66rem;letter-spacing:.16em;text-transform:uppercase;color:var(--dim)}
.c-title{font-size:1.02rem;font-weight:700;color:var(--gold);line-height:1.2}
.c-line{font-size:.76rem;color:var(--dim);line-height:1.5}
.c-read{margin-top:auto;padding-top:.6rem;display:flex;flex-direction:column;gap:.1rem}
.c-val{font-size:1.75rem;line-height:1.1;color:var(--ink)}
.c-val.v-warn{color:var(--warn)}.c-val.v-red{color:var(--bad)}
.c-unit{font-size:.72rem;color:var(--dim)}
.c-sub{font-size:.7rem;color:var(--dim);margin-top:.15rem}
.c-open{margin-top:auto;padding-top:.8rem;font-size:.74rem;color:var(--gold)}
/* the graph card's lens row — deep links into ONE page, drawn as the same
   pills the opsnav uses so they read as handles, not as more doors */
.card .c-door{display:flex;flex-direction:column;flex:1;text-decoration:none;color:inherit}
.c-lenses{display:flex;flex-wrap:wrap;gap:.3rem;padding:0 .9rem .9rem}
.c-lenses a{text-decoration:none;color:var(--dim);border:1px solid var(--line);border-radius:999px;
 padding:.12rem .6rem;font-size:.7rem;letter-spacing:.06em}
.c-lenses a:hover{color:var(--gold);border-color:var(--gold)}
.card .spark{margin-top:.4rem;width:100%;height:30px;display:block}
.c-chips{margin-top:.55rem;display:flex;flex-wrap:wrap;gap:.1rem}
.alert{border-left:2px solid var(--bad);padding:.4rem .8rem;margin:.9rem 0 0;font-size:.78rem;color:var(--ink);max-width:88ch}
.ok-line{color:var(--dim);font-size:.78rem;margin:.9rem 0 0}
`;

const html = V.page({
  title: "postmark · ops",
  h1: "Postmark ops", sub: "the shelf of instruments for keeping the town",
  here: "/ops/",
  stamp: `hub regenerated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · each card reads its own dashboard's data.json twin · <a href="data.json">roll-up</a>`,
  body: `${banner}<nav class="shelf" aria-label="Operator dashboards">${cards.join("")}</nav>`,
  footer: `Every card's number and trend come from the dashboard's own published JSON twin, and the chip beside it is that twin's <code>generated_at</code>, not this page's — so an instrument that stops is visible from the hub instead of only from its own frozen page. Generator: <code>postmark-office/tools/ops-index.mjs</code>, hourly cron, after its five siblings. Unlinked + noindex.`,
  extraCss: EXTRA,
});

mkdirSync(OPS_ROOT, { recursive: true });
writeFileSync(join(OPS_ROOT, "index.html"), html);
writeFileSync(join(OPS_ROOT, "data.json"), JSON.stringify({
  generated_at: new Date().toISOString(), dashboards: roll,
  not_fresh: stale.map(([k]) => k),
}, null, 2));
console.log(`ops-index: wrote ${OPS_ROOT}/index.html — ${Object.keys(roll).length} instruments, ${stale.length} not fresh`);
