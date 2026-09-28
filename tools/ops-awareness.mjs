#!/usr/bin/env node
// ops-awareness.mjs — the postmark.town/ops/awareness tally (POS-282).
//
// Awareness is one of the six pillars (postmark.md § The operating model), and
// until this page its only instruments were joins and Discord arrivals. This is
// ONE weekly reading across the channels: followers and views per channel
// (Reddit, X, Bluesky, YouTube; TikTok is a row that says it is not open yet),
// the households that joined, and the new members of the Discord.
//
// ── WHERE EACH NUMBER IS READ (measured 2026-09-28 from a desk, no key) ─────
//
//   Bluesky   followers   the public AppView, app.bsky.actor.getProfile — no
//                         key. Bluesky counts no views, so that cell says so.
//   YouTube   subscribers + channel views   the channel's /about page, which
//                         carries "subscriberCountText" and "viewCountText" in
//                         its JSON — no key. A page, not an API: if YouTube
//                         changes the page the cell says "not read", never 0.
//   Discord   members     the invite's own counts (?with_counts=true) — no key.
//                         Bots are members too, so this is members, and "new"
//                         is the change since last week's reading.
//   households joined     the /ops/activity twin (its residents' white-pages
//                         Joined dates), read from $OPS_ROOT — no key. A
//                         household is new the week its first resident joined.
//   Reddit    followers + views   BY HAND. about.json answers 403 without
//                         OAuth, and the views are the moderators' insights.
//   X         followers + views   BY HAND. The API needs a paid key.
//
// Everything BY HAND comes from a small file (deploy/awareness-by-hand.json, or
// AWARENESS_BY_HAND) keyed by ISO week, and the page labels each such number
// "entered by hand, <date>". No key is read by this tool, and none belongs in
// that file. An automatic number wins over a hand one for the same cell.
//
// ── ONE LINE PER WEEK ───────────────────────────────────────────────────────
//
// history.jsonl beside the page holds one line per ISO week (Monday–Sunday,
// UTC). The hourly run rewrites the current week's line with its latest
// reading, so the line a week keeps is its last reading; earlier weeks are
// never re-read, only filled in where a hand entry arrives late.
//
// Zero new dependencies. Node 20+.

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as V from "./lib/ops-viz.mjs";

const { esc, comma } = V;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DAY = 864e5;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const addDays = (day, n) => iso(Date.parse(`${day}T00:00:00Z`) + n * DAY);

export const UA = "postmark-ops-awareness/1 (+https://postmark.town/ops/awareness/)";
export const SOURCES = Object.freeze({
  bluesky: "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=postmark-town.bsky.social",
  youtube: "https://www.youtube.com/@postmarktown/about",
  discord: "https://discord.com/api/v10/invites/wVCF9ChZum?with_counts=true",
});

// The channels, in the order the page reads them. `followers`/`views` say
// where each number comes from: "auto", "hand", or null for a count the
// channel does not keep.
export const CHANNELS = Object.freeze([
  { key: "reddit", name: "Reddit", where: "r/PostmarkTown", followers: "hand", views: "hand" },
  { key: "x", name: "X", where: "@PostmarkTown", followers: "hand", views: "hand" },
  { key: "bluesky", name: "Bluesky", where: "postmark-town.bsky.social", followers: "auto", views: null },
  { key: "youtube", name: "YouTube", where: "@postmarktown", followers: "auto", views: "auto" },
  { key: "tiktok", name: "TikTok", where: "not open yet", open: false },
]);

// ── the week ─────────────────────────────────────────────────────────────────
export const mondayOf = (day) => addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
export function isoWeek(day) {
  const d = new Date(`${day}T00:00:00Z`);
  const thursday = new Date(d.getTime() + (3 - ((d.getUTCDay() + 6) % 7)) * DAY);
  const jan1 = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  return `${thursday.getUTCFullYear()}-W${String(Math.ceil(((thursday - jan1) / DAY + 1) / 7)).padStart(2, "0")}`;
}

// ── the readers (pure: they take what the network answered) ────────────────

/** "1.2K subscribers" → 1200; "8 subscribers" → 8; anything else → null. */
export function countOf(text) {
  const m = /^([\d.,]+)\s*([KMB])?\b/i.exec(String(text ?? "").trim());
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * ({ K: 1e3, M: 1e6, B: 1e9 }[m[2]?.toUpperCase()] ?? 1));
}

export function parseYouTube(html) {
  const field = (name) => { const m = new RegExp(`"${name}":"([^"]*)"`).exec(String(html ?? "")); return m ? countOf(m[1]) : null; };
  return { followers: field("subscriberCountText"), views: field("viewCountText") };
}

export function parseBluesky(body) {
  const n = Number(body?.followersCount);
  return { followers: Number.isInteger(n) ? n : null };
}

export function parseDiscordInvite(body) {
  const n = Number(body?.approximate_member_count);
  return { members: Number.isInteger(n) ? n : null };
}

/** Households whose first resident joined in the week starting `monday`, from the activity twin. */
export function newHouseholds(activity, monday) {
  if (!Array.isArray(activity?.residents)) return null;
  const first = new Map();
  for (const r of activity.residents) {
    if (r.meep || !r.household || !r.joined) continue;
    const j = String(r.joined).slice(0, 10);
    if (!first.has(r.household) || j < first.get(r.household)) first.set(r.household, j);
  }
  const end = addDays(monday, 7);
  return [...first.values()].filter((j) => j >= monday && j < end).length;
}

/** Ask the three public sources. Each failure is that cell's "not read", never a zero. */
export async function readChannels({ fetchImpl = globalThis.fetch, timeoutMs = 10_000 } = {}) {
  const get = async (url, as) => {
    try {
      const res = await fetchImpl(url, { headers: { "user-agent": UA, accept: as === "json" ? "application/json" : "text/html", "accept-language": "en-US" }, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) return { error: `HTTP ${res.status}` };
      return { body: as === "json" ? await res.json() : await res.text() };
    } catch (e) {
      return { error: String(e?.message ?? e).slice(0, 60) };
    }
  };
  const [bs, yt, dc] = await Promise.all([get(SOURCES.bluesky, "json"), get(SOURCES.youtube, "text"), get(SOURCES.discord, "json")]);
  return {
    bluesky: bs.error ? { error: bs.error } : parseBluesky(bs.body),
    youtube: yt.error ? { error: yt.error } : parseYouTube(yt.body),
    discord: dc.error ? { error: dc.error } : parseDiscordInvite(dc.body),
  };
}

// ── the week's line ──────────────────────────────────────────────────────────

const cell = (value, source) => ({ value: value ?? null, source: value == null ? null : source });

/**
 * One week's line. `read` is readChannels' answer (null for weeks not read
 * now); `hand` is the by-hand file's entry for this week; `prev` is last week's
 * line, for the Discord's change.
 */
export function weekLine({ week, from, now, read, hand, prev, households }) {
  const h = hand ?? {};
  const handSrc = h.entered ? `entered by hand, ${h.entered}` : "entered by hand";
  const channels = {};
  for (const c of CHANNELS) {
    if (c.open === false) { channels[c.key] = { open: false }; continue; }
    const auto = read?.[c.key] ?? {};
    const pick = (kind) => {
      if (c[kind] === null) return { value: null, source: null, none: true };
      const a = auto[kind] ?? null;
      if (a != null) return cell(a, `read ${iso(now)}`);
      const hv = h[c.key]?.[kind];
      if (Number.isFinite(hv)) return cell(hv, handSrc);
      return { value: null, source: null, missing: c[kind] === "auto" ? (auto.error ? `not read (${auto.error})` : "not read") : "not entered" };
    };
    channels[c.key] = { followers: pick("followers"), views: pick("views") };
  }
  const members = read?.discord?.members ?? null;
  const prevMembers = prev?.discord?.members ?? null;
  const handNew = Number.isFinite(h.discord?.new_humans) ? h.discord.new_humans : null;
  const discord = {
    members,
    members_error: members == null ? (read?.discord?.error ? `not read (${read.discord.error})` : "not read") : null,
    new: handNew != null ? cell(handNew, handSrc)
      : members != null && prevMembers != null ? cell(members - prevMembers, `change since ${prev.week}`)
      : { value: null, source: null, missing: prevMembers == null ? "no reading last week" : "not read" },
  };
  return { week, from, recorded_at: new Date(now).toISOString(), channels, discord, new_households: households ?? null };
}

/** Fill a past week's empty cells from a hand entry that arrived late. Automatic numbers stay. */
export function fillFromHand(line, hand) {
  if (!hand) return line;
  const src = hand.entered ? `entered by hand, ${hand.entered}` : "entered by hand";
  const out = structuredClone(line);
  for (const c of CHANNELS) {
    const ch = out.channels?.[c.key];
    if (!ch || ch.open === false) continue;
    for (const kind of ["followers", "views"]) {
      const hv = hand[c.key]?.[kind];
      if (ch[kind]?.value == null && !ch[kind]?.none && Number.isFinite(hv)) ch[kind] = cell(hv, src);
    }
  }
  if (out.discord && out.discord.new?.value == null && Number.isFinite(hand.discord?.new_humans)) out.discord.new = cell(hand.discord.new_humans, src);
  return out;
}

/** The history with this week's line in place of any earlier reading of it, oldest first. */
export function upsertWeek(history, line) {
  return [...history.filter((l) => l.week !== line.week), line].sort((a, b) => a.from.localeCompare(b.from));
}

export const followersTotal = (line) => CHANNELS.reduce((s, c) => s + (line.channels?.[c.key]?.followers?.value ?? 0), 0);

/**
 * This week against last, like for like: only the channels with a follower
 * count in BOTH weeks, so a channel read this week and missing last week is
 * never counted as growth. Null when there is no last week.
 */
export function followersChange(cur, prev) {
  if (!prev) return null;
  const both = CHANNELS.filter((c) => cur.channels?.[c.key]?.followers?.value != null && prev.channels?.[c.key]?.followers?.value != null);
  const sum = (l) => both.reduce((s, c) => s + l.channels[c.key].followers.value, 0);
  return { cur: sum(cur), prev: sum(prev), channels: both.length };
}

// ── the page ─────────────────────────────────────────────────────────────────

const num = (c, missing = "—") => c?.value != null ? `<span class="num">${comma(c.value)}</span>` : `<span class="dim">${esc(c?.none ? "not kept" : c?.missing ?? missing)}</span>`;
const src = (c) => c?.source ? `<span class="dim">${esc(c.source)}</span>` : "";
const delta = (cur, prev) => cur?.value != null && prev?.value != null ? V.deltaLine(cur.value, prev.value) : "";

export function render(M) {
  const cur = M.history.at(-1);
  const prev = M.history.length > 1 ? M.history.at(-2) : null;
  const chips = [
    `generated ${M.generated_at.slice(0, 16).replace("T", " ")}Z`,
    `week ${cur.week} (from ${cur.from})`,
    `weeks recorded: ${M.history.length}`,
    `by hand: ${M.by_hand}`,
    `households: ${M.activity_source}`,
  ].map((s) => V.chip(/not read|missing|none/.test(s) ? "warn" : "", s)).join("");

  const note = `<p class="note"><b>One reading a week.</b> Followers and views are each channel's own running totals, read
once an hour; a week keeps its last reading, and the change is against last week's. Bluesky, YouTube and the Discord are read from
public pages with no key. Reddit and X are <b>entered by hand</b> and say so beside the number. A number that could not be read says
<b>not read</b>, and one nobody entered says <b>not entered</b>; neither is ever drawn as a zero.</p>`;

  const rows = CHANNELS.map((c) => {
    const ch = cur.channels[c.key];
    if (ch.open === false) return [`<span class="who">${esc(c.name)}</span>`, `<span class="dim">not open yet</span>`, "", "", ""];
    const p = prev?.channels?.[c.key];
    return [`<span class="who">${esc(c.name)}</span> <span class="dim">${esc(c.where)}</span>`,
      `${num(ch.followers)} ${src(ch.followers)}`, delta(ch.followers, p?.followers),
      `${num(ch.views)} ${src(ch.views)}`, delta(ch.views, p?.views)];
  });
  const channelTable = V.table(["channel", "followers", "vs last week", "views", "vs last week"], rows);

  const kpiRow = V.kpis([
    { label: `followers, all channels · ${cur.week}`, value: comma(followersTotal(cur)), sub: (() => { const ch = followersChange(cur, prev); return !ch ? "first week recorded" : !ch.channels ? "no channel counted in both weeks"
      : `${V.deltaLine(ch.cur, ch.prev)} · the ${ch.channels} channel${ch.channels === 1 ? "" : "s"} counted both weeks`; })(),
      spark: V.sparkline(M.history.slice(-14).map(followersTotal), { title: "followers across channels, week by week" }) },
    { label: `new households · ${cur.week}`, value: cur.new_households == null ? "—" : comma(cur.new_households), sub: "the week its first resident joined" },
    { label: `new in the Discord · ${cur.week}`, value: cur.discord.new.value == null ? "—" : comma(cur.discord.new.value),
      sub: cur.discord.new.value == null ? esc(cur.discord.new.missing) : esc(cur.discord.new.source) },
    { label: "Discord members", value: cur.discord.members == null ? "—" : comma(cur.discord.members), sub: cur.discord.members == null ? esc(cur.discord.members_error) : "bots included" },
  ]);

  const f = (c) => c?.value != null ? comma(c.value) : `<span class="dim">—</span>`;
  const weekTable = V.table(["ISO week", "from", ...CHANNELS.filter((c) => c.open !== false).flatMap((c) => [`${esc(c.name)} followers`, ...(c.views === null ? [] : [`${esc(c.name)} views`])]), "new households", "Discord members", "new in the Discord"],
    M.history.slice().reverse().map((l) => [l.week, l.from,
      ...CHANNELS.filter((c) => c.open !== false).flatMap((c) => [f(l.channels[c.key]?.followers), ...(c.views === null ? [] : [f(l.channels[c.key]?.views)])]),
      l.new_households == null ? `<span class="dim">—</span>` : comma(l.new_households),
      l.discord?.members == null ? `<span class="dim">—</span>` : comma(l.discord.members), f(l.discord?.new)]));

  const body = `
${chips}
${note}
${kpiRow}
<section class="fig"><h2>This week, channel by channel</h2>
<div class="tablewrap">${channelTable}</div></section>
<section class="fig"><h2>Every week</h2>
<p class="note">One line per ISO week, Monday to Sunday UTC, kept in <code>history.jsonl</code> beside this page.</p>
<div class="tablewrap">${weekTable}</div></section>
`;
  return V.page({
    title: "postmark · ops · awareness",
    h1: "awareness: who has heard of us", sub: "postmark.town/ops/awareness",
    here: "/ops/awareness/",
    stamp: `unlinked operator page · channel totals from public pages and a hand-kept file · <a href="data.json">data.json</a>`,
    body,
    footer: `Generator: <code>postmark-office/tools/ops-awareness.mjs</code>, hourly cron on the box. Read with no key:
Bluesky's public profile, YouTube's channel page, the Discord invite's counts, and the <a href="/ops/activity/">activity</a> twin for
the households. Entered by hand: Reddit and X (<code>deploy/awareness-by-hand.json</code>). Unlinked + noindex; the hub is <a href="/ops/">/ops/</a>.`,
  });
}

/** The twin the hub reads. */
export function twin(M) {
  const cur = M.history.at(-1);
  const prev = M.history.length > 1 ? M.history.at(-2) : null;
  return {
    generated_at: M.generated_at,
    week: cur.week,
    recent: {
      // the headline is the whole total; its change is like for like (followersChange)
      followers: { cur: followersTotal(cur), prev: prev ? followersTotal(prev) : null },
      followers_change: followersChange(cur, prev),
      new_households: cur.new_households,
      discord_new: cur.discord.new.value,
      spark: M.history.slice(-14).map(followersTotal),
    },
    weeks_recorded: M.history.length,
    history: M.history,
  };
}

// ── main ─────────────────────────────────────────────────────────────────────
function args(argv, env) {
  const flag = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
  const opsRoot = env.OPS_ROOT || "/var/www/postmark-ops";
  return {
    out: flag("out") ?? env.AWARENESS_OUT ?? join(opsRoot, "awareness"),
    byHand: flag("by-hand") ?? env.AWARENESS_BY_HAND ?? join(ROOT, "deploy", "awareness-by-hand.json"),
    activity: flag("activity") ?? env.AWARENESS_ACTIVITY ?? join(opsRoot, "activity", "data.json"),
    now: Date.parse(flag("now") ?? env.AWARENESS_NOW ?? "") || Date.now(),
    offline: argv.includes("--offline") || env.AWARENESS_OFFLINE === "1",
  };
}

const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

async function main() {
  const a = args(process.argv.slice(2), process.env);
  const hand = existsSync(a.byHand) ? readJson(a.byHand) : null;
  if (existsSync(a.byHand) && !hand) {
    console.error(`ops-awareness: ${a.byHand} is not JSON — fix it or move it aside; nothing was written`);
    process.exit(2);
  }
  const activity = existsSync(a.activity) ? readJson(a.activity) : null;
  const today = iso(a.now);
  const from = mondayOf(today);
  const week = isoWeek(today);
  const histPath = join(a.out, "history.jsonl");
  const history0 = existsSync(histPath)
    ? readFileSync(histPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  const read = a.offline
    ? { bluesky: { error: "offline" }, youtube: { error: "offline" }, discord: { error: "offline" } }
    : await readChannels();
  const prev = history0.filter((l) => l.from < from).at(-1) ?? null;
  const line = weekLine({ week, from, now: a.now, read, hand: hand?.weeks?.[week], prev, households: newHouseholds(activity, from) });
  const history = upsertWeek(history0, line).map((l) => (l.week === week ? l : fillFromHand(l, hand?.weeks?.[l.week])));
  const M = {
    generated_at: new Date(a.now).toISOString(), history,
    by_hand: hand ? `${Object.keys(hand.weeks ?? {}).length} week(s) in ${a.byHand.split(/[\\/]/).pop()}` : `none (${a.byHand} missing)`,
    activity_source: activity ? "the activity twin" : `not read (no ${a.activity})`,
  };
  mkdirSync(a.out, { recursive: true });
  writeFileSync(histPath, history.map((l) => JSON.stringify(l)).join("\n") + "\n");
  writeFileSync(join(a.out, "index.html"), render(M));
  writeFileSync(join(a.out, "data.json"), JSON.stringify(twin(M), null, 1));
  console.log(`ops-awareness: ${week} — ${followersTotal(line)} followers across channels, ${history.length} week(s) recorded → ${a.out}/index.html`);
}

// The office's realpath idiom (tools/ops-activity.mjs): a URL compare goes
// false through a Windows junction and the tool would exit 0 having done nothing.
const isMain = process.argv[1] && realpathSync(process.argv[1]).replace(/\\/g, "/").endsWith("/ops-awareness.mjs");
if (isMain) {
  main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
}
