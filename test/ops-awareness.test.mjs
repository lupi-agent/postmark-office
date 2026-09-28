// ops-awareness.test.mjs — the /ops/awareness tally's falsifiers (POS-282).
//   node --test test/ops-awareness.test.mjs
//
// The readers are pure and are handed what the network answered (snippets of
// the real answers, measured 2026-09-28). The CLI runs --offline, so nothing
// here reaches the network.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CHANNELS, isoWeek, mondayOf, countOf, parseYouTube, parseBluesky, parseDiscordInvite, newHouseholds,
  weekLine, fillFromHand, upsertWeek, followersTotal, followersChange, readChannels,
} from "../tools/ops-awareness.mjs";

const ROOT = join(import.meta.dirname, "..");
const GEN = join(ROOT, "tools", "ops-awareness.mjs");
const HUB = join(ROOT, "tools", "ops-index.mjs");
const roots = [];
const fresh = () => { const r = mkdtempSync(join(tmpdir(), "ops-awareness-")); roots.push(r); return r; };
after(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

const NOW = Date.parse("2026-09-30T12:00:00Z"); // a Wednesday in 2026-W40

test("the week is the ISO week, Monday to Sunday UTC", () => {
  assert.equal(isoWeek("2026-09-28"), "2026-W40");
  assert.equal(isoWeek("2026-10-04"), "2026-W40", "Sunday closes the week");
  assert.equal(isoWeek("2026-09-27"), "2026-W39");
  assert.equal(isoWeek("2027-01-01"), "2026-W53", "a Friday New Year belongs to the old year's last week");
  assert.equal(isoWeek("2026-01-01"), "2026-W01");
  assert.equal(mondayOf("2026-10-04"), "2026-09-28");
});

test("counts read from the page's own words; a word that is not a count is null, never 0", () => {
  assert.equal(countOf("8 subscribers"), 8);
  assert.equal(countOf("1.2K subscribers"), 1200);
  assert.equal(countOf("1,234 views"), 1234);
  assert.equal(countOf("No views"), null);
  assert.equal(countOf(undefined), null);
});

test("YouTube: subscribers and channel views from the about page's JSON", () => {
  const html = `...,"subscriberCountText":"8 subscribers","videoCountText":"4 videos","viewCountText":"24 views",...`;
  assert.deepEqual(parseYouTube(html), { followers: 8, views: 24 });
  assert.deepEqual(parseYouTube("<html>a consent wall</html>"), { followers: null, views: null }, "a changed page is not read");
});

test("Bluesky's followers and the Discord invite's members", () => {
  assert.deepEqual(parseBluesky({ handle: "postmark-town.bsky.social", followersCount: 12, followsCount: 34 }), { followers: 12 });
  assert.deepEqual(parseBluesky({ error: "InvalidRequest" }), { followers: null });
  assert.deepEqual(parseDiscordInvite({ approximate_member_count: 140, approximate_presence_count: 51 }), { members: 140 });
  assert.deepEqual(parseDiscordInvite({ message: "Unknown Invite" }), { members: null });
});

test("a failed source is that cell's 'not read', and the others still read", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("bsky")) return { ok: true, json: async () => ({ followersCount: 12 }) };
    if (url.includes("youtube")) return { ok: false, status: 429 };
    throw new Error("offline");
  };
  const r = await readChannels({ fetchImpl });
  assert.deepEqual(r.bluesky, { followers: 12 });
  assert.deepEqual(r.youtube, { error: "HTTP 429" });
  assert.deepEqual(r.discord, { error: "offline" });
});

const ACTIVITY = { residents: [
  { handle: "a1", household: "alpha", joined: "2026-09-29" },
  { handle: "a2", household: "alpha", joined: "2026-10-01" },
  { handle: "b1", household: "beta", joined: "2026-09-01" },
  { handle: "b2", household: "beta", joined: "2026-09-30", note: "a second resident does not make an old house new" },
  { handle: "g1", household: "gamma", joined: "2026-10-04T23:00:00Z" },
  { handle: "d1", household: "delta", joined: "2026-10-05", note: "next week" },
  { handle: "ferry", household: "the-town", joined: "2026-09-29", meep: true },
  { handle: "n1", household: "nu", joined: null },
] };

test("a household is new the week its first resident joined; meeps and undated residents are not counted", () => {
  assert.equal(newHouseholds(ACTIVITY, "2026-09-28"), 2, "alpha and gamma");
  assert.equal(newHouseholds(ACTIVITY, "2026-10-05"), 1, "delta");
  assert.equal(newHouseholds(null, "2026-09-28"), null, "no twin is not zero households");
});

const READ = { bluesky: { followers: 12 }, youtube: { followers: 8, views: 24 }, discord: { members: 140 } };
const HAND = { entered: "2026-10-04", reddit: { followers: 31, views: 900 }, x: { followers: 5, views: null }, youtube: { followers: 99 } };

test("the week's line: automatic numbers, hand numbers labelled, and a gap says which kind of gap", () => {
  const prev = { week: "2026-W39", from: "2026-09-21", discord: { members: 133 } };
  const l = weekLine({ week: "2026-W40", from: "2026-09-28", now: NOW, read: READ, hand: HAND, prev, households: 2 });
  assert.deepEqual(l.channels.reddit.followers, { value: 31, source: "entered by hand, 2026-10-04" });
  assert.deepEqual(l.channels.x.views, { value: null, source: null, missing: "not entered" });
  assert.deepEqual(l.channels.youtube.followers, { value: 8, source: "read 2026-09-30" }, "an automatic number wins over a hand one");
  assert.equal(l.channels.bluesky.views.none, true, "Bluesky keeps no views");
  assert.deepEqual(l.channels.tiktok, { open: false });
  assert.deepEqual(l.discord.new, { value: 7, source: "change since 2026-W39" });
  assert.equal(l.new_households, 2);
  assert.equal(followersTotal(l), 31 + 5 + 12 + 8);
  const lastWeek = weekLine({ week: "2026-W39", from: "2026-09-21", now: NOW, read: { bluesky: { followers: 10 } }, hand: null, prev: null, households: null });
  assert.deepEqual(followersChange(l, lastWeek), { cur: 12, prev: 10, channels: 1 }, "growth is like for like: a channel missing last week is not growth");
  assert.equal(followersChange(l, null), null);

  const noPrev = weekLine({ week: "2026-W40", from: "2026-09-28", now: NOW, read: READ, hand: null, prev: null, households: null });
  assert.equal(noPrev.discord.new.missing, "no reading last week");
  assert.equal(noPrev.channels.reddit.followers.missing, "not entered");

  const down = weekLine({ week: "2026-W40", from: "2026-09-28", now: NOW, read: { youtube: { error: "HTTP 429" } }, hand: null, prev, households: null });
  assert.equal(down.channels.youtube.followers.missing, "not read (HTTP 429)");
  assert.equal(down.discord.members_error, "not read");

  const handNew = weekLine({ week: "2026-W40", from: "2026-09-28", now: NOW, read: READ, hand: { entered: "2026-10-04", discord: { new_humans: 4 } }, prev, households: 0 });
  assert.deepEqual(handNew.discord.new, { value: 4, source: "entered by hand, 2026-10-04" }, "a hand count of humans overrides the member change");
});

test("one line per week: a later reading replaces the week's line, a late hand entry fills a past week's gaps", () => {
  const w39 = weekLine({ week: "2026-W39", from: "2026-09-21", now: NOW - 7 * 864e5, read: READ, hand: null, prev: null, households: 1 });
  const w40a = weekLine({ week: "2026-W40", from: "2026-09-28", now: NOW, read: READ, hand: null, prev: w39, households: 1 });
  const w40b = weekLine({ week: "2026-W40", from: "2026-09-28", now: NOW + 3600e3, read: { ...READ, bluesky: { followers: 13 } }, hand: null, prev: w39, households: 1 });
  const h = upsertWeek(upsertWeek([w39], w40a), w40b);
  assert.deepEqual(h.map((l) => l.week), ["2026-W39", "2026-W40"]);
  assert.equal(h[1].channels.bluesky.followers.value, 13);

  const filled = fillFromHand(w39, HAND);
  assert.deepEqual(filled.channels.reddit.followers, { value: 31, source: "entered by hand, 2026-10-04" });
  assert.equal(filled.channels.youtube.followers.value, 8, "the week's automatic reading stays");
  assert.equal(w39.channels.reddit.followers.value, null, "and the line it was given is not mutated");
});

// ── the CLI, offline ─────────────────────────────────────────────────────────

function run(opsRoot, now, byHand) {
  return execFileSync(process.execPath, [GEN, "--offline", "--now", now, "--by-hand", byHand], { encoding: "utf8", env: { ...process.env, OPS_ROOT: opsRoot } });
}

test("two weeks recorded: one history line each, the page labels hand numbers, TikTok, and what was not read", () => {
  const opsRoot = fresh();
  mkdirSync(join(opsRoot, "activity"), { recursive: true });
  writeFileSync(join(opsRoot, "activity", "data.json"), JSON.stringify(ACTIVITY));
  const byHand = join(opsRoot, "by-hand.json");
  writeFileSync(byHand, JSON.stringify({ weeks: { "2026-W40": { entered: "2026-10-04", reddit: { followers: 31, views: 900 }, x: { followers: 5, views: 70 } },
    "2026-W41": { entered: "2026-10-11", reddit: { followers: 40, views: 1200 } } } }));
  run(opsRoot, "2026-09-30T12:00:00Z", byHand);
  run(opsRoot, "2026-10-01T12:00:00Z", byHand);
  run(opsRoot, "2026-10-07T12:00:00Z", byHand);
  const out = join(opsRoot, "awareness");
  const lines = readFileSync(join(out, "history.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.week), ["2026-W40", "2026-W41"], "two runs in one week are one line");
  assert.equal(lines[0].recorded_at, "2026-10-01T12:00:00.000Z", "the week keeps its last reading");
  assert.equal(lines[0].new_households, 2);
  const html = readFileSync(join(out, "index.html"), "utf8");
  assert.match(html, /entered by hand, 2026-10-11/);
  assert.match(html, /not open yet/);
  assert.match(html, /not read \(offline\)/);
  assert.match(html, /not entered/, "X's views were not entered for W41");
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  const d = JSON.parse(readFileSync(join(out, "data.json"), "utf8"));
  assert.equal(d.week, "2026-W41");
  assert.equal(d.weeks_recorded, 2);
  assert.equal(d.generated_at, "2026-10-07T12:00:00.000Z");
  assert.deepEqual(d.recent.followers, { cur: 40, prev: 36 });
  assert.deepEqual(d.recent.followers_change, { cur: 40, prev: 31, channels: 1 }, "X was not entered for W41, so only Reddit is compared");
});

test("a by-hand file that is not JSON is refused before anything is written", () => {
  const opsRoot = fresh();
  const bad = join(opsRoot, "bad.json");
  writeFileSync(bad, "{ reddit: 12 ");
  assert.throws(() => run(opsRoot, "2026-09-30T12:00:00Z", bad), (e) => e.status === 2 && /is not JSON/.test(e.stderr));
  assert.throws(() => readFileSync(join(opsRoot, "awareness", "history.jsonl")), /ENOENT/);
});

test("the committed by-hand file is numbers and nulls, keyed by ISO week — no key or token", () => {
  const raw = readFileSync(join(ROOT, "deploy", "awareness-by-hand.json"), "utf8");
  const f = JSON.parse(raw);
  for (const [week, e] of Object.entries(f.weeks)) {
    assert.match(week, /^\d{4}-W\d{2}$/);
    for (const [k, v] of Object.entries(e)) {
      if (k === "entered") { assert.ok(v === null || /^\d{4}-\d{2}-\d{2}$/.test(v)); continue; }
      for (const n of Object.values(v)) assert.ok(n === null || Number.isFinite(n), `${week}.${k} holds a number or null`);
    }
  }
  assert.doesNotMatch(raw, /token"\s*:|"key"\s*:|secret|Bearer|sk-|ghp_/i);
  assert.deepEqual(CHANNELS.filter((c) => c.followers === "hand").map((c) => c.key), ["reddit", "x"], "the hand channels are the ones the file names");
});

test("the hub carries an awareness card from the twin", () => {
  const opsRoot = fresh();
  mkdirSync(join(opsRoot, "awareness"), { recursive: true });
  writeFileSync(join(opsRoot, "awareness", "data.json"), JSON.stringify({ generated_at: new Date().toISOString(), week: "2026-W40",
    recent: { followers: { cur: 56, prev: 50 }, followers_change: { cur: 56, prev: 50, channels: 4 }, new_households: 2, discord_new: 7, spark: [50, 56] } }));
  execFileSync(process.execPath, [HUB], { encoding: "utf8", env: { ...process.env, OPS_ROOT: opsRoot } });
  const html = readFileSync(join(opsRoot, "index.html"), "utf8");
  const at = html.indexOf('<a class="card" href="awareness/">');
  assert.ok(at >= 0, "the hub has an awareness card");
  const card = html.slice(at, html.indexOf("</a>", at));
  assert.match(card, /<span class="c-val">56<\/span>/);
  assert.match(card, /followers across channels, 2026-W40/);
  assert.match(card, /▲ 12% vs last week · 2 new households · 7 new in the Discord/);
  assert.match(card, /chip ok">fresh/);
  const roll = JSON.parse(readFileSync(join(opsRoot, "data.json"), "utf8"));
  assert.equal(roll.dashboards.awareness.freshness, "ok");
});
