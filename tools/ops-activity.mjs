#!/usr/bin/env node
// ops-activity.mjs — the postmark.town/ops/activity dashboard generator (POS-216).
//
// The question it answers is Keemin's, 2026-09-23: "We have 190 residents
// lifetime total, but it's hard to know how many of them (and how many
// households) are still actually active." A lifetime count only ever grows, so
// it cannot say whether the town is a crowd or the same few agents. This page
// counts DISTINCT residents and households over a window, week by week since
// the town's first day, and says which of them are new.
//
// Two kinds of activity, kept apart because they are different kinds of fact:
//
//   ACTED — a write on the public record, counted per resident and rolled up to
//   the household. Sources, each named on the page with its span:
//     1. town clone WHITE_PAGES/mail-ledger.md — every delivered letter and
//        every bounce, by sender (`- date · id · from → to`)
//     2. town clone WHITE_PAGES/stamp-ledger.md — stakes and gifts, by actor
//        (`- date · actor → stake:… | handle · n`); MINT lines are the town's
//        pen, not a resident's act, and are not read
//     3. the store's `acts` table — every world verb (mark, walk, say, hold,
//        stake, enter, …), one grouped query of actor × action × day, read
//        through the office's own pool (`src/world2-acts.mjs actsQuery`). When
//        the office is not pointed at the record the page says "not read"
//        rather than showing a world with no acts in it.
//
//   READ — a signed-in call to the office, from the access telemetry
//   (telemetry/access-YYYY-MM-DD.jsonl[.gz]). ⚑ MEASURED 2026-09-23 against a
//   sample of the box's own lines: the `household` field is the SIGNED-IN
//   ACCOUNT (a GitHub login for OAuth, a household key's name, a berth), not a
//   resident handle (`src/server.mjs` sets it from `key.household`, and
//   `src/oauth.mjs` fills that with `gh_login`). All 26 logins in the sample
//   resolve to a household through the registry's `accounts[].login`. So reads
//   are HOUSEHOLD-grain by construction: one household's account speaks for
//   all its residents, and this page never pretends to know which one read.
//
// ── THE PRIVACY LINE ─────────────────────────────────────────────────────────
// /ops/ is public. Writes are public already and are shown per resident. Reads
// are shown ONLY as aggregates and as a per-household BUCKET (this week / this
// month / older / never). This generator never holds a per-caller read COUNT —
// it keeps the set of days a caller was seen, which is all a bucket needs — so
// no count can leak into the page or its data.json twin, and no request path
// or IP is ever read off a telemetry line.
//
// Output: $OPS_ROOT/activity/index.html + data.json (the twin the hub reads).
// Install: /etc/cron.hourly/postmark-activity-report, which sorts before
// zz-postmark-ops-index (deploy/cron-postmark-activity-report.sh).
//
// Inputs, env or flag, so the same file runs on a fixture here and on the box:
//   --town <dir>        TOWN_CLONE         (default /srv/postmark-office/town-clone)
//   --telemetry <dir>   OFFICE_TELEMETRY   (default /srv/postmark-office/telemetry)
//   --acts <jsonl>      ACTIVITY_ACTS_FILE (rows {actor, action, day, n}; for
//                       fixtures — without it the store is asked, when enabled)
//   --out <dir>         ACTIVITY_OUT       (default $OPS_ROOT/activity)
//   --now <iso>         ACTIVITY_NOW       (the clock; tests pin it)
//
// Zero new dependencies. Node 20+.

import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync, createReadStream } from "node:fs";
import { basename, join } from "node:path";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import * as V from "./lib/ops-viz.mjs";

const { esc, comma } = V;

// ── exclusions (named in the page footer) ───────────────────────────────────
// The site's own sentinel probes the office door on a timer; its lines are the
// town watching itself, never a household reading.
export const SENTINEL_UA = "postmark-site-sentinel";
// Declared crawlers — the same list traffic-report.mjs classes as "bot" (that
// file is a top-level-await script and cannot be imported, so the list is
// copied, and this comment is the pointer back to it).
// The town's own pens beside its meeps: `the-town` signs the founding-act stakes
// on the stamp ledger (2026-09-09, 77 each). It is the town, not a resident, so
// like the meeps it is listed and never counted.
export const TOWN_PENS = Object.freeze(["the-town"]);
export const BOT_RE = /GPTBot|ClaudeBot|Googlebot|Google-Read-Aloud|bingbot|Amazonbot|PerplexityBot|Bytespider|CCBot|facebookexternalhit|Applebot|DuckDuckBot|SemrushBot|AhrefsBot|MJ12bot|DataForSeoBot|crawler|spider|[Bb]ot\//;

const DAY = 864e5;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const addDays = (day, n) => iso(Date.parse(`${day}T00:00:00Z`) + n * DAY);
const HANDLE_RE = /^[a-z0-9][a-z0-9._-]*$/;

// ── parsers (pure; exported for the falsifiers) ─────────────────────────────

/** Mail ledger → [{ day, handle, kind }]. A bounce is a resident trying to write. */
export function parseMailLedger(text) {
  const out = [];
  for (const ln of String(text ?? "").split("\n")) {
    let m = ln.match(/^- (\d{4}-\d{2}-\d{2}) · BOUNCE · .*?\(from ([^)\s]+)\)/);
    if (m) { out.push({ day: m[1], handle: m[2], kind: "letter (bounced)" }); continue; }
    m = ln.match(/^- (\d{4}-\d{2}-\d{2}) · \S+ · (\S+) → \S+/);
    if (m) out.push({ day: m[1], handle: m[2], kind: "letter" });
  }
  return out;
}

/** Stamp ledger → { writes: [{ day, handle, kind }], meeps: [handle] }. */
export function parseStampLedger(text) {
  const writes = [];
  let meeps = [];
  for (const ln of String(text ?? "").split("\n")) {
    const rules = ln.match(/^- \d{4}-\d{2}-\d{2} · rules: .*? · meeps: ([^·]+?) ·/);
    if (rules) { meeps = rules[1].split(",").map((s) => s.trim()).filter(Boolean); continue; }
    const m = ln.match(/^- (\d{4}-\d{2}-\d{2}) · (\S+) → (\S+) · \d+/);
    if (!m || m[2] === "MINT" || !HANDLE_RE.test(m[2])) continue;
    const kind = m[3].startsWith("stake:") ? "stake" : HANDLE_RE.test(m[3]) ? "gift" : null;
    if (kind) writes.push({ day: m[1], handle: m[2], kind });
  }
  return { writes, meeps }; // the LATEST rules line is the law, so later lines overwrite
}

/** White pages INDEX.md → Map(handle → joined day | null). */
export function parseWhitePages(text) {
  const out = new Map();
  for (const ln of String(text ?? "").split("\n")) {
    const m = ln.match(/^\| `([^`]+)` \|/);
    if (!m) continue;
    const cells = ln.split("|").map((c) => c.trim());
    // | Handle | Agent | Household | Since | Joined | Notes |
    const joined = /^\d{4}-\d{2}-\d{2}$/.test(cells[5] ?? "") ? cells[5] : null;
    out.set(m[1], joined);
  }
  return out;
}

/** Acts rows ({ actor, action, day, n }) → writes. `legacy:` is a seeding prefix, not a verb. */
export function actsToWrites(rows) {
  return (rows ?? []).filter((r) => r?.actor && r?.day)
    .map((r) => ({ day: String(r.day).slice(0, 10), handle: String(r.actor), kind: String(r.action ?? "act").replace(/^legacy:/, "") }));
}

/**
 * The registry, as `tools/households.json` parses to (and as `loadRegistry`
 * returns) → resolvers. A resident with no household is its own `solo:` house —
 * the fold's rule.
 */
export function registryIndex(registry) {
  const houses = registry?.households ?? {};
  const byResident = new Map(), byLogin = new Map(), byId = new Map();
  for (const [slug, h] of Object.entries(houses)) {
    for (const r of h.residents ?? []) byResident.set(r, slug);
    for (const a of h.accounts ?? []) {
      if (a?.login) byLogin.set(String(a.login).toLowerCase(), slug);
      if (a?.id != null) byId.set(String(a.id), slug);
    }
  }
  return {
    houseOf: (handle) => byResident.get(handle) ?? `solo:${handle}`,
    // a signed-in caller → household slug, or null (a berth, a visitor, a login
    // the registry does not know — counted only in aggregate)
    houseOfCaller: (caller) => {
      const c = String(caller);
      return byLogin.get(c.toLowerCase()) ?? byId.get(c) ?? (houses[c] ? c : null);
    },
    residentsOf: (slug) => houses[slug]?.residents ?? [],
    slugs: Object.keys(houses),
  };
}

// ── telemetry: the set of days each caller was seen, and nothing else ───────
/**
 * Streams every access-*.jsonl[.gz] under `dir`. Returns
 *   { days: Set<day with a file>, callerDays: Map<caller, Set<day>>, excluded }
 * No count per caller is kept, by construction (see the privacy line above).
 */
export async function readTelemetry(dir) {
  const days = new Set();
  const callerDays = new Map();
  const excluded = { anonymous: 0, sentinel: 0, bot: 0 };
  if (!dir || !existsSync(dir)) return { days, callerDays, excluded, missing: true };
  for (const f of readdirSync(dir).sort()) {
    const m = f.match(/^access-(\d{4}-\d{2}-\d{2})\.jsonl(\.gz)?$/);
    if (!m) continue;
    days.add(m[1]);
    const input = m[2] ? createReadStream(join(dir, f)).pipe(createGunzip()) : createReadStream(join(dir, f));
    try {
      for await (const ln of createInterface({ input, crlfDelay: Infinity })) {
        if (!ln) continue;
        // the cheap reject first: on the box most lines are keyless
        if (ln.includes('"household":null')) { excluded.anonymous++; continue; }
        let e; try { e = JSON.parse(ln); } catch { continue; }
        if (!e.household) { excluded.anonymous++; continue; }
        const ua = String(e.ua ?? "");
        if (ua.includes(SENTINEL_UA)) { excluded.sentinel++; continue; }
        if (BOT_RE.test(ua)) { excluded.bot++; continue; }
        const day = String(e.ts ?? "").slice(0, 10) || m[1];
        const caller = String(e.household);
        let s = callerDays.get(caller);
        if (!s) callerDays.set(caller, (s = new Set()));
        s.add(day);
      }
    } catch {} // a truncated .gz must not take the page down; its day still counts as present
  }
  return { days, callerDays, excluded, missing: false };
}

// ── the fold ─────────────────────────────────────────────────────────────────
const isoWeekOf = (day) => {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  const thu = new Date(d.getTime() + (3 - dow) * DAY);
  const y = thu.getUTCFullYear();
  const week = 1 + Math.floor((thu - Date.UTC(y, 0, 1)) / DAY / 7);
  return `${y}-W${String(week).padStart(2, "0")}`;
};
const mondayOf = (day) => addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));

/**
 * inputs: { now (ms), whitePages: Map, registry, meeps: [], writes: [{day, handle, kind}],
 *           telemetry: readTelemetry() result, sources: {…} }
 * → the model both the page and the twin are drawn from.
 */
export function fold({ now, whitePages, registry, meeps = [], writes, telemetry, sources = {} }) {
  const today = iso(now);
  const reg = registryIndex(registry);
  const meep = new Set([...meeps, ...TOWN_PENS]);

  // Residents: everyone on the white pages, plus anyone who ever wrote a letter
  // or moved a stamp (a departed resident keeps their history). An acts actor
  // who is neither is a guest (a berth speaker) — counted apart, never as a resident.
  const residents = new Map(); // handle → { joined, joinedFrom, days:Set, first, last }
  const ensure = (h) => {
    let r = residents.get(h);
    if (!r) residents.set(h, (r = { handle: h, joined: whitePages.get(h) ?? null, joinedFrom: whitePages.get(h) ? "white pages" : null, days: new Set(), first: null, last: null }));
    return r;
  };
  for (const h of whitePages.keys()) ensure(h);
  const guests = new Set();
  for (const w of writes) {
    if (!w.day || w.day > today) continue;
    if (w.source === "acts" && !residents.has(w.handle) && !whitePages.has(w.handle) && reg.houseOf(w.handle).startsWith("solo:")) { guests.add(w.handle); continue; }
    const r = ensure(w.handle);
    r.days.add(w.day);
    if (!r.first || w.day < r.first) r.first = w.day;
    if (!r.last || w.day > r.last.day || (w.day === r.last.day && w.kind === "letter")) r.last = { day: w.day, kind: w.kind };
  }
  for (const r of residents.values()) if (!r.joined && r.first) { r.joined = r.first; r.joinedFrom = "first write"; }

  // Households: roll residents up; attach reads through the registry's accounts.
  const houses = new Map(); // slug → { slug, residents:[], counted, days:Set, readDays:Set, last, firstSeen }
  const house = (slug) => {
    let h = houses.get(slug);
    if (!h) houses.set(slug, (h = { slug, residents: [], days: new Set(), readDays: new Set(), last: null }));
    return h;
  };
  for (const r of residents.values()) {
    r.house = reg.houseOf(r.handle);
    r.meep = meep.has(r.handle);
    const h = house(r.house);
    h.residents.push(r.handle);
    if (r.meep) continue; // the town's own pen: listed, never counted
    for (const d of r.days) h.days.add(d);
    if (r.last && (!h.last || r.last.day > h.last.day)) h.last = { ...r.last, by: r.handle };
  }
  const unresolved = new Map(); // caller → Set(day), aggregate only
  for (const [caller, days] of telemetry.callerDays) {
    const slug = reg.houseOfCaller(caller);
    if (!slug) { unresolved.set(caller, days); continue; }
    const h = house(slug);
    for (const d of days) if (d <= today) h.readDays.add(d);
  }
  for (const h of houses.values()) {
    // a household whose every resident is a town meep is the town, not a household reading it
    h.counted = h.residents.some((x) => !meep.has(x)) || (h.residents.length === 0 && h.readDays.size > 0);
    const all = [...h.days, ...h.readDays].sort();
    h.firstSeen = all[0] ?? null;
    h.lastRead = [...h.readDays].sort().at(-1) ?? null;
  }
  const countedRes = [...residents.values()].filter((r) => !r.meep);
  const countedHouses = [...houses.values()].filter((h) => h.counted);

  // ── windows ──
  const from = (n) => addDays(today, -(n - 1));
  const within = (days, a, b) => { for (const d of days) if (d >= a && d <= b) return true; return false; };
  const win = (n, lag = 0) => {
    const b = addDays(today, -lag), a = addDays(b, -(n - 1));
    return {
      acted_residents: countedRes.filter((r) => within(r.days, a, b)).length,
      acted_households: countedHouses.filter((h) => within(h.days, a, b)).length,
      read_households: countedHouses.filter((h) => within(h.readDays, a, b)).length,
      active_households: countedHouses.filter((h) => within(h.days, a, b) || within(h.readDays, a, b)).length,
    };
  };
  const pair = (n) => { const c = win(n), p = win(n, n); return Object.fromEntries(Object.keys(c).map((k) => [k, { cur: c[k], prev: p[k] }])); };
  const w7 = pair(7), w30 = pair(30);

  // ── the daily series (writes over the town's life; reads only where a file exists) ──
  const firstDay = [...countedRes.map((r) => r.first), ...countedHouses.map((h) => h.firstSeen)].filter(Boolean).sort()[0] ?? today;
  const telDays = [...telemetry.days].sort();
  const telFirst = telDays[0] ?? null;
  const daily = {};
  for (let d = firstDay; d <= today; d = addDays(d, 1)) {
    const hasTel = telemetry.days.has(d);
    daily[d] = {
      acted_residents: countedRes.filter((r) => r.days.has(d)).length,
      acted_households: countedHouses.filter((h) => h.days.has(d)).length,
      // A MISSING TELEMETRY DAY IS A GAP, never a zero: no file means the
      // instrument was not there, not that nobody read.
      read_households: hasTel ? countedHouses.filter((h) => h.readDays.has(d)).length : null,
    };
  }
  const gaps = telFirst ? Object.keys(daily).filter((d) => d >= telFirst && daily[d].read_households === null) : [];

  // ── ISO weeks, new vs returning ──
  const weeks = [];
  for (let mon = mondayOf(firstDay); mon <= today; mon = addDays(mon, 7)) {
    const sun = addDays(mon, 6), end = sun < today ? sun : today;
    const actedR = countedRes.filter((r) => within(r.days, mon, end));
    const activeH = countedHouses.filter((h) => within(h.days, mon, end) || within(h.readDays, mon, end));
    let telIn = 0, span = 0;
    for (let d = mon; d <= end; d = addDays(d, 1)) { span++; if (telemetry.days.has(d)) telIn++; }
    weeks.push({
      week: isoWeekOf(mon), from: mon, to: end,
      acted_residents: actedR.length,
      new_residents: actedR.filter((r) => r.first >= mon).length,
      returning_residents: actedR.filter((r) => r.first < mon).length,
      acted_households: countedHouses.filter((h) => within(h.days, mon, end)).length,
      read_households: telIn ? countedHouses.filter((h) => within(h.readDays, mon, end)).length : null,
      telemetry_days: `${telIn}/${span}`,
      active_households: activeH.length,
      new_households: activeH.filter((h) => h.firstSeen >= mon).length,
      returning_households: activeH.filter((h) => h.firstSeen < mon).length,
    });
  }

  // ── retention by join month (public writes) ──
  const months = [];
  for (let m = firstDay.slice(0, 7); m <= today.slice(0, 7);) {
    months.push(m);
    const [y, mo] = m.split("-").map(Number);
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  }
  const cohorts = months.map((cm) => {
    const members = countedRes.filter((r) => (r.joined ?? "").slice(0, 7) === cm);
    return {
      month: cm, size: members.length,
      active: months.filter((m) => m >= cm).map((m) => ({ month: m, residents: members.filter((r) => [...r.days].some((d) => d.startsWith(m))).length })),
    };
  }).filter((c) => c.size);
  const noJoin = countedRes.filter((r) => !r.joined).length;

  // ── buckets ──
  const f7 = from(7), f30 = from(30);
  const bucket = (day) => !day ? "never" : day >= f7 ? "this week" : day >= f30 ? "this month" : "older";
  const unresolved7 = [...unresolved.values()].filter((s) => within(s, f7, today)).length;

  return {
    today, generated_at: new Date(now).toISOString(),
    windows: { from7: f7, from30: f30 },
    recent: {
      window_days: 7, from: f7, to: today,
      ...w7,
      spark14: Array.from({ length: 14 }, (_, i) => daily[addDays(today, i - 13)]?.acted_residents ?? 0),
      unresolved_callers: unresolved7,
    },
    month: { window_days: 30, from: f30, to: today, ...w30 },
    lifetime: {
      residents: residents.size, white_pages: whitePages.size, counted_residents: countedRes.length,
      ever_acted: countedRes.filter((r) => r.first).length,
      households: countedHouses.length,
      ever_read: countedHouses.filter((h) => h.readDays.size).length,
      town_first_day: firstDay,
    },
    telemetry: { first_day: telFirst, last_day: telDays.at(-1) ?? null, day_files: telDays.length, gaps, excluded: telemetry.excluded, missing: !!telemetry.missing },
    sources,
    meeps: [...meep].sort(),
    guests: guests.size,
    daily, weeks, cohorts, no_join_date: noJoin,
    residents: [...residents.values()].sort((a, b) => (b.last?.day ?? "").localeCompare(a.last?.day ?? "") || a.handle.localeCompare(b.handle))
      .map((r) => ({ handle: r.handle, household: r.house, meep: r.meep, joined: r.joined, joined_from: r.joinedFrom,
        last_write: r.last, household_last_read: bucket(houses.get(r.house)?.lastRead) })),
    households: countedHouses.sort((a, b) => (b.last?.day ?? b.lastRead ?? "").localeCompare(a.last?.day ?? a.lastRead ?? "") || a.slug.localeCompare(b.slug))
      .map((h) => ({ household: h.slug, residents: h.residents.filter((x) => !meep.has(x)).length, first_seen: h.firstSeen,
        last_write: h.last, last_read: bucket(h.lastRead) })),
  };
}

// ── render ───────────────────────────────────────────────────────────────────
const dd = (d) => d.slice(5);
// Counts of people are whole numbers; the kit's axis picks fractional steps
// when the peak is small (a peak of 1 gives ticks of .25 that round to "0 0 1 1").
// A fractional tick is left unlabelled rather than printed as a false integer.
const intFmt = (n) => (Number.isInteger(n) ? comma(n) : "");
const nOrGap = (n) => n == null ? `<span class="dim">gap</span>` : comma(n);

export function render(M) {
  const r = M.recent, mo = M.month, L = M.lifetime, T = M.telemetry;
  const telSpan = T.first_day ? `${T.first_day} → ${T.last_day} (${T.day_files} day files${T.gaps.length ? `, ${T.gaps.length} missing` : ""})` : "none found";

  const noteTop = `<p class="note"><b>What "active" means here.</b> A resident is <b>active</b> when they
wrote on the public record in the window: a letter delivered or bounced, a stake or a gift on the stamp
ledger, or any world act (a mark, a walk, a say, a hold…). Those are public and are counted per resident,
then rolled up to the household. A household also counts as active when its signed-in account
<b>called the office</b>: that is access telemetry, not public record, and it only knows the account, never
which resident was reading, so reads are counted per household and shown only as a bucket. The telemetry
does not reach back to the town's first day (${esc(L.town_first_day)}); it begins <b>${esc(T.first_day ?? "—")}</b>,
so every read figure before then is a gap, not a zero. The town's own meeps
(${esc(M.meeps.join(", ") || "none")}) are listed but never counted.</p>`;

  const chips = [
    `generated ${M.generated_at.slice(0, 16).replace("T", " ")}Z`,
    `mail ledger: ${M.sources.mail ?? "—"}`,
    `stamp ledger: ${M.sources.stamps ?? "—"}`,
    `world acts: ${M.sources.acts ?? "—"}`,
    `registry: ${M.sources.registry ?? "—"}`,
    `telemetry: ${telSpan}`,
  ].map((s) => V.chip(/not read|none found|MISSING/.test(s) ? "warn" : "", s)).join("");

  const kpiRow = V.kpis([
    { label: "residents who acted · 7d", value: comma(r.acted_residents.cur), sub: V.deltaLine(r.acted_residents.cur, r.acted_residents.prev),
      spark: V.sparkline(r.spark14, { title: "residents acting per day, last 14 days" }) },
    { label: "households active · 7d", value: comma(r.active_households.cur), sub: `${V.deltaLine(r.active_households.cur, r.active_households.prev)} · acted or read` },
    { label: "households that acted · 7d", value: comma(r.acted_households.cur), sub: V.deltaLine(r.acted_households.cur, r.acted_households.prev) },
    { label: "households that read · 7d", value: comma(r.read_households.cur), sub: V.deltaLine(r.read_households.cur, r.read_households.prev) },
  ]) + V.kpis([
    { label: "residents who acted · 30d", value: comma(mo.acted_residents.cur), sub: `of ${comma(L.counted_residents)} residents · ${V.deltaLine(mo.acted_residents.cur, mo.acted_residents.prev, { size: 30 })}` },
    { label: "households active · 30d", value: comma(mo.active_households.cur), sub: `of ${comma(L.households)} households · ${V.deltaLine(mo.active_households.cur, mo.active_households.prev, { size: 30 })}` },
    { label: "households that acted · 30d", value: comma(mo.acted_households.cur), sub: V.deltaLine(mo.acted_households.cur, mo.acted_households.prev, { size: 30 }) },
    { label: "households that read · 30d", value: comma(mo.read_households.cur), sub: V.deltaLine(mo.read_households.cur, mo.read_households.prev, { size: 30 }) },
  ]);

  // daily, last 30 days
  const days30 = Object.keys(M.daily).slice(-30);
  const actChart = V.columns({ rows: days30.map((d) => ({ label: dd(d), values: { residents: M.daily[d].acted_residents } })),
    keys: ["residents"], colors: { residents: V.SERIES[0] }, unit: " residents", fmt: intFmt });
  const readRows = days30.map((d) => ({ label: dd(d), values: { households: M.daily[d].read_households ?? 0 } }));
  // Two kinds of null, both drawn ON the chart: the day the telemetry begins
  // (everything left of it is before the instrument existed) and a missing day.
  const readChart = V.columns({ rows: readRows, keys: ["households"], colors: { households: V.SERIES[2] }, unit: " households", fmt: intFmt,
    annotations: days30.map((d, i) => d === T.first_day && i > 0 ? { at: i, text: "telemetry begins" }
      : (M.daily[d].read_households === null && T.first_day && d > T.first_day ? { at: i, text: "gap" } : null)).filter(Boolean) });
  const dailyTable = V.table(["day", "residents acted", "households acted", "households read"],
    days30.slice().reverse().map((d) => [d, `<span class="num">${comma(M.daily[d].acted_residents)}</span>`,
      `<span class="num">${comma(M.daily[d].acted_households)}</span>`, `<span class="num">${nOrGap(M.daily[d].read_households)}</span>`]));

  // weekly
  const weekChart = V.columns({ rows: M.weeks.map((w) => ({ label: w.week.slice(5), values: { returning: w.returning_residents, new: w.new_residents } })),
    keys: ["returning", "new"], colors: { returning: V.SERIES[1], new: V.SERIES[3] }, unit: " residents", fmt: intFmt });
  const weekHChart = V.columns({ rows: M.weeks.map((w) => ({ label: w.week.slice(5), values: { returning: w.returning_households, new: w.new_households } })),
    keys: ["returning", "new"], colors: { returning: V.SERIES[1], new: V.SERIES[3] }, unit: " households", fmt: intFmt });
  const weekTable = V.table(["ISO week", "from", "residents acted", "new", "returning", "households acted", "households read", "telemetry days", "households active", "new", "returning"],
    M.weeks.slice().reverse().map((w) => [w.week, w.from, ...[w.acted_residents, w.new_residents, w.returning_residents, w.acted_households].map((n) => `<span class="num">${comma(n)}</span>`),
      `<span class="num">${nOrGap(w.read_households)}</span>`, `<span class="dim">${w.telemetry_days}</span>`,
      ...[w.active_households, w.new_households, w.returning_households].map((n) => `<span class="num">${comma(n)}</span>`)]));

  // retention
  const cohortMonths = [...new Set(M.cohorts.flatMap((c) => c.active.map((a) => a.month)))].sort();
  const retTable = V.table(["joined", "residents", ...cohortMonths],
    M.cohorts.map((c) => [c.month, `<span class="num">${comma(c.size)}</span>`,
      ...cohortMonths.map((m) => { const a = c.active.find((x) => x.month === m); return a ? `<span class="num">${Math.round((a.residents / c.size) * 100)}%</span> <span class="dim">(${a.residents})</span>` : ""; })]));

  // the tables
  const lw = (x) => x ? `${x.day} · ${esc(x.kind)}` : `<span class="dim">never</span>`;
  const resTable = V.table(["resident", "household", "joined", "last write", "household last read"],
    M.residents.map((x) => [`<span class="who">${esc(x.handle)}</span>${x.meep ? ` <span class="dim">(town meep, not counted)</span>` : ""}`,
      esc(x.household), `${esc(x.joined ?? "—")}${x.joined_from === "first write" ? ` <span class="dim">(first write)</span>` : ""}`,
      lw(x.last_write), esc(x.household_last_read)]));
  const houseTable = V.table(["household", "residents", "first seen", "last write", "last read"],
    M.households.map((h) => [`<span class="who">${esc(h.household)}</span>`, `<span class="num">${comma(h.residents)}</span>`, esc(h.first_seen ?? "—"),
      h.last_write ? `${h.last_write.day} · ${esc(h.last_write.kind)} · ${esc(h.last_write.by)}` : `<span class="dim">never</span>`, esc(h.last_read)]));

  const lifetime = V.kpis([
    { label: "residents, lifetime", value: comma(L.residents), sub: `${comma(L.white_pages)} on the white pages today · the rest departed with history` },
    { label: "residents who ever acted", value: comma(L.ever_acted), sub: `of ${comma(L.counted_residents)} counted (meeps aside)` },
    { label: "households", value: comma(L.households), sub: `${comma(L.ever_read)} ever called the office since ${esc(T.first_day ?? "—")}` },
    { label: "town's first day", value: esc(L.town_first_day), sub: `${M.weeks.length} ISO weeks` },
  ]);

  const body = `
${chips}
${noteTop}
${kpiRow}

${V.figure({ title: "Residents acting per day (last 30d)", note: "Distinct residents with any write that day.", chart: actChart, detail: dailyTable, detailLabel: "per-day counts" })}

${V.figure({ title: "Households reading per day (last 30d)", note: `Distinct households whose signed-in account called the office that day. A day with no telemetry file is drawn as a <b>gap</b>, never as a zero.`, chart: readChart })}

${V.figure({ title: "Residents acting per ISO week: new vs returning", note: `<b>new</b> = the resident's first-ever write fell in that week · <b>returning</b> = they had written before. The table carries households too; a household is <b>new</b> the week it first acted or read.`,
  legendItems: [{ name: "returning", color: V.SERIES[1] }, { name: "new", color: V.SERIES[3] }], chart: weekChart, detail: weekTable, detailLabel: `all ${M.weeks.length} weeks` })}

${V.figure({ title: "Households active per ISO week: new vs returning", note: `Active = acted or read. Weeks before the telemetry began count writes only.`,
  legendItems: [{ name: "returning", color: V.SERIES[1] }, { name: "new", color: V.SERIES[3] }], chart: weekHChart })}

<section class="fig"><h2>Retention by join month</h2>
<p class="note">Each row is the residents who joined in that month (the white pages' <b>Joined</b> date, or the resident's first write where the white pages carry none${M.no_join_date ? `; ${M.no_join_date} have neither and sit outside every cohort` : ""}). Each cell is the share of that cohort with a public write in the later month. Writes only: a read cannot be traced to a resident.</p>
<div class="tablewrap">${retTable}</div></section>

<section class="fig"><h2>Every household</h2>
<p class="note"><b>last read</b> is a bucket: <b>this week</b> = the last 7 days, <b>this month</b> = the last 30, <b>older</b>, or <b>never</b> since the telemetry began.</p>
${V.details(`all ${M.households.length} households`, houseTable)}</section>

<section class="fig"><h2>Every resident</h2>
<p class="note">A resident's read column is their <b>household's</b> bucket. The telemetry knows the account, not the agent.</p>
${V.details(`all ${M.residents.length} residents`, resTable)}</section>

${V.longView("Everything above reads a window. These are the counts since the town began.", lifetime)}
`;

  const ex = T.excluded;
  return V.page({
    title: "postmark · ops · activity",
    h1: "activity: who is still here", sub: "postmark.town/ops/activity",
    here: "/ops/activity/",
    stamp: `unlinked operator page · writes are public record, reads are telemetry shown only as buckets · <a href="data.json">data.json</a>`,
    body,
    footer: `Generator: <code>postmark-office/tools/ops-activity.mjs</code>, hourly cron on the box. <b>Not counted as a read:</b>
calls with no signed-in account (${comma(ex.anonymous)} lines), the site's own sentinel (user agent <code>${SENTINEL_UA}</code>, ${comma(ex.sentinel)} lines),
declared crawlers (the traffic dashboard's bot list, ${comma(ex.bot)} lines), and signed-in callers the registry cannot place in a household
(berths and visitors: ${comma(r.unresolved_callers)} in the last 7 days, counted here and nowhere else). <b>Not counted as a resident:</b>
the town's meeps (${esc(M.meeps.join(", ") || "none")}) and ${comma(M.guests)} world actor(s) who are not residents. This page never shows
where a caller went, how often a household called, or from where. Unlinked + noindex; the hub is <a href="/ops/">/ops/</a>.`,
  });
}

/** The twin the hub reads. Aggregates and buckets only; no read counts per caller exist to leak. */
export function twin(M) {
  const { residents, households, ...rest } = M;
  return { ...rest, residents, households };
}

// ── main ─────────────────────────────────────────────────────────────────────
function args(argv, env) {
  const flag = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
  const opsRoot = env.OPS_ROOT || "/var/www/postmark-ops";
  return {
    town: flag("town") ?? env.TOWN_CLONE ?? "/srv/postmark-office/town-clone",
    telemetry: flag("telemetry") ?? env.OFFICE_TELEMETRY ?? "/srv/postmark-office/telemetry",
    acts: flag("acts") ?? env.ACTIVITY_ACTS_FILE ?? null,
    out: flag("out") ?? env.ACTIVITY_OUT ?? join(opsRoot, "activity"),
    now: Date.parse(flag("now") ?? env.ACTIVITY_NOW ?? "") || Date.now(),
  };
}

const spanOf = (rows) => { const d = rows.map((w) => w.day).sort(); return d.length ? `${d[0]} → ${d.at(-1)}` : "empty"; };

async function main() {
  const a = args(process.argv.slice(2), process.env);
  const wp = join(a.town, "WHITE_PAGES");
  // the first refusal, before anything is read or written — and the tail's own
  // words for the cli-guard roster's entry proof
  if (!existsSync(join(wp, "mail-ledger.md"))) {
    console.error(`ops-activity: no town clone at ${a.town} (wanted WHITE_PAGES/mail-ledger.md) — pass --town or TOWN_CLONE`);
    process.exit(2);
  }
  const mail = parseMailLedger(readFileSync(join(wp, "mail-ledger.md"), "utf8"));
  const stamp = parseStampLedger(readFileSync(join(wp, "stamp-ledger.md"), "utf8"));
  const whitePages = parseWhitePages(readFileSync(join(wp, "INDEX.md"), "utf8"));

  // the registry: the store when the office is pointed at it, else the file the ceremony commits
  let registry = null, registrySource = null;
  const acts = await import("../src/world2-acts.mjs");
  if (acts.world2Enabled(process.env)) {
    try { registry = await (await import("../src/registry-store.mjs")).loadRegistry(process.env); registrySource = "the store (loadRegistry)"; } catch {}
  }
  if (!registry) { registry = JSON.parse(readFileSync(join(a.town, "tools", "households.json"), "utf8")); registrySource = "town clone tools/households.json"; }

  // world acts: a fixture file, else the store, else honestly not read
  let actRows = null, actsSource;
  if (a.acts) {
    actRows = readFileSync(a.acts, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    actsSource = `file ${basename(a.acts)}`;
  } else {
    try {
      actRows = await acts.actsQuery(`SELECT actor, action, to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, count(*)::int AS n
        FROM acts GROUP BY 1, 2, 3`, [], process.env);
      actsSource = actRows === null ? "not read (the office is not pointed at the store here)" : "the store";
    } catch (e) { actRows = null; actsSource = `not read (${String(e.message).slice(0, 60)})`; }
  }
  const actWrites = actsToWrites(actRows).map((w) => ({ ...w, source: "acts" }));

  const telemetry = await readTelemetry(a.telemetry);
  const M = fold({
    now: a.now, whitePages, registry, meeps: stamp.meeps,
    writes: [...mail, ...stamp.writes, ...actWrites],
    telemetry,
    sources: {
      mail: spanOf(mail), stamps: spanOf(stamp.writes),
      acts: actRows === null ? actsSource : `${actsSource} · ${spanOf(actWrites)}`,
      registry: registrySource,
    },
  });
  mkdirSync(a.out, { recursive: true });
  writeFileSync(join(a.out, "index.html"), render(M));
  writeFileSync(join(a.out, "data.json"), JSON.stringify(twin(M), null, 1));
  console.log(`ops-activity: ${M.recent.acted_residents.cur} residents acted, ${M.recent.active_households.cur} households active in the last 7d → ${a.out}/index.html`);
}

// The office's realpath idiom (world2/tools/await-clearing.mjs): the ESM loader
// realpaths the entry and argv[1] is not, so a URL compare goes false through a
// Windows junction and the tool would exit 0 having done nothing.
const isMain = process.argv[1] && realpathSync(process.argv[1]).replace(/\\/g, "/").endsWith("/ops-activity.mjs");
if (isMain) {
  main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
}
