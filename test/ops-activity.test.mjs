// ops-activity.test.mjs — the /ops/activity generator's falsifiers (POS-216).
//   node --test test/ops-activity.test.mjs
//
// Every count below is a HAND count, written out in test/ops-activity-fixture.mjs
// beside the fixture that produces it. Each guard that says something must not
// count is paired with a flip showing that, with the guard's input changed, the
// same code DOES count it — a falsifier that cannot go red proves nothing.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildFixture, NOW, EXPECT, UA, PATHS } from "./ops-activity-fixture.mjs";
import {
  fold, readTelemetry, parseMailLedger, parseStampLedger, parseWhitePages, actsToWrites, render,
} from "../tools/ops-activity.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const GEN = join(ROOT, "tools", "ops-activity.mjs");
const HUB = join(ROOT, "tools", "ops-index.mjs");

const roots = [];
test.after(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });
const fresh = () => { const r = mkdtempSync(join(tmpdir(), "ops-activity-")); roots.push(r); return r; };

/** Run the real CLI over a fresh fixture; hand back the page, the twin and the fixture. */
function runCli() {
  const root = fresh();
  const fx = buildFixture(root);
  const out = join(root, "ops", "activity");
  execFileSync(process.execPath, [GEN, "--town", fx.town, "--telemetry", fx.telemetry, "--acts", fx.acts, "--out", out, "--now", NOW],
    { encoding: "utf8", env: { ...process.env, WORLD2_PG: "", WORLD2_PG_URL: "" } });
  return { root, fx, out, html: readFileSync(join(out, "index.html"), "utf8"), twinText: readFileSync(join(out, "data.json"), "utf8") };
}

/** The same fold the CLI runs, in-process, so a flip can change one input. */
async function model(fx, { telemetryDir = fx.telemetry, dropMail = null } = {}) {
  const wp = join(fx.town, "WHITE_PAGES");
  let mail = parseMailLedger(readFileSync(join(wp, "mail-ledger.md"), "utf8"));
  if (dropMail) mail = mail.filter((w) => !dropMail(w));
  const stamp = parseStampLedger(readFileSync(join(wp, "stamp-ledger.md"), "utf8"));
  const acts = actsToWrites(readFileSync(fx.acts, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))).map((w) => ({ ...w, source: "acts" }));
  return fold({
    now: Date.parse(NOW),
    whitePages: parseWhitePages(readFileSync(join(wp, "INDEX.md"), "utf8")),
    registry: JSON.parse(readFileSync(join(fx.town, "tools", "households.json"), "utf8")),
    meeps: stamp.meeps,
    writes: [...mail, ...stamp.writes, ...acts],
    telemetry: await readTelemetry(telemetryDir),
  });
}

/** Copy the fixture's telemetry dir, rewriting one line on the way. Asserts the rewrite happened. */
function telemetryWith(fx, edit) {
  const dir = join(fresh(), "telemetry");
  mkdirSync(dir, { recursive: true });
  let changed = 0;
  for (const f of readdirSync(fx.telemetry)) {
    const before = readFileSync(join(fx.telemetry, f), "utf8");
    const after = edit(f, before);
    if (after !== before) changed++;
    writeFileSync(join(dir, f), after);
  }
  assert.ok(changed > 0, "the flip changed no telemetry file — it would prove nothing");
  return dir;
}

test("the trailing-7-day distinct counts equal the hand count, and households roll up through the registry with a solo: case", () => {
  const { twinText } = runCli();
  const d = JSON.parse(twinText);
  assert.equal(d.recent.acted_residents.cur, EXPECT.acted_residents_7);
  assert.equal(d.recent.acted_households.cur, EXPECT.acted_households_7);
  assert.equal(d.recent.read_households.cur, EXPECT.read_households_7);
  assert.equal(d.recent.active_households.cur, EXPECT.active_households_7);
  assert.equal(d.month.acted_residents.cur, EXPECT.acted_residents_30);
  assert.equal(d.month.acted_households.cur, EXPECT.acted_households_30);
  assert.equal(d.month.read_households.cur, EXPECT.read_households_30);
  assert.equal(d.month.active_households.cur, EXPECT.active_households_30);
  // ada and bram are one household; gus has none and is his own house
  const house = Object.fromEntries(d.residents.map((r) => [r.handle, r.household]));
  assert.equal(house.ada, "lantern-house");
  assert.equal(house.bram, "lantern-house");
  assert.equal(house.gus, "solo:gus");
  assert.ok(d.households.some((h) => h.household === "solo:gus"), "the solo house is a household in its own right");
  // new vs returning, ISO week 2026-W39
  const w39 = d.weeks.find((w) => w.week === "2026-W39");
  assert.equal(w39.new_residents, EXPECT.w39_new_residents);
  assert.equal(w39.returning_residents, EXPECT.w39_returning_residents);
});

test("a resident whose letter is on the ledger this week is active with zero telemetry — and is not, once the letter is gone", async () => {
  const root = fresh();
  const fx = buildFixture(root);
  const M = await model(fx);
  const gus = M.residents.find((r) => r.handle === "gus");
  assert.equal(gus.last_write.day, "2026-09-21");
  assert.equal(gus.household_last_read, "never", "the fixture gives gus's house no telemetry at all");
  assert.equal(M.recent.acted_residents.cur, EXPECT.acted_residents_7);
  // FLIP: the same fold without gus's letter
  const without = await model(fx, { dropMail: (w) => w.handle === "gus" });
  assert.equal(without.recent.acted_residents.cur, EXPECT.acted_residents_7 - 1);
});

test("the sentinel's lines, a crawler's lines and household:null lines never count — and the same line with an ordinary agent does", async () => {
  const root = fresh();
  const fx = buildFixture(root);
  const M = await model(fx);
  const quiet = M.households.find((h) => h.household === "quiet-house");
  assert.equal(quiet.last_read, "never", "QuietOne appears only as the sentinel and as GPTBot");
  assert.equal(M.recent.read_households.cur, EXPECT.read_households_7);

  // FLIP 1: the sentinel's line with a human browser's agent — now it is a read
  const sentinelOff = await model(fx, { telemetryDir: telemetryWith(fx, (f, t) => t.split(UA.sentinel).join(UA.chrome)) });
  assert.equal(sentinelOff.households.find((h) => h.household === "quiet-house").last_read, "this week");
  assert.equal(sentinelOff.recent.read_households.cur, EXPECT.read_households_7 + 1);

  // FLIP 2: the crawler's line with an ordinary agent — also a read
  const botOff = await model(fx, { telemetryDir: telemetryWith(fx, (f, t) => t.split(UA.bot).join(UA.node)) });
  assert.equal(botOff.recent.read_households.cur, EXPECT.read_households_7 + 1);

  // null lines: five hundred more change nothing…
  const nulls = Array.from({ length: 500 }, (_, i) => JSON.stringify({ ts: "2026-09-22T13:00:00.000Z", method: "GET", path: "/me", status: 200, ms: 3, ua: UA.chrome, household: null, mcp: null })).join("\n") + "\n";
  const moreNull = await model(fx, { telemetryDir: telemetryWith(fx, (f, t) => f === "access-2026-09-22.jsonl" ? t + nulls : t) });
  assert.deepEqual(moreNull.recent, M.recent);
  // …and FLIP 3: the same lines carrying QuietOne's login are reads
  const named = await model(fx, { telemetryDir: telemetryWith(fx, (f, t) => f === "access-2026-09-22.jsonl" ? t + nulls.split('"household":null').join('"household":"QuietOne"') : t) });
  assert.equal(named.recent.read_households.cur, EXPECT.read_households_7 + 1);
});

test("a missing telemetry day is a GAP (null) in the series, never a zero", () => {
  const { twinText, html } = runCli();
  const d = JSON.parse(twinText);
  assert.equal(d.daily["2026-09-15"].read_households, null);
  assert.equal(typeof d.daily["2026-09-14"].read_households, "number");
  assert.equal(typeof d.daily["2026-09-16"].read_households, "number");
  assert.deepEqual(d.telemetry.gaps, ["2026-09-15"]);
  // before the telemetry began is also not a zero
  assert.equal(d.daily["2026-09-01"].read_households, null);
  // the week holding the gap says how much of it the instrument saw
  assert.equal(d.weeks.find((w) => w.from === "2026-09-14").telemetry_days, "6/7");
  // writes are public record every day, so they are never a gap
  assert.equal(d.daily["2026-09-15"].acted_residents, 0);
  assert.match(html, /gap/);
});

test("the page and its twin carry no request path, no user agent and no per-household read count", () => {
  const { html, twinText } = runCli();
  for (const [name, text] of [["page", html], ["data.json", twinText]]) {
    for (const p of PATHS) assert.ok(!text.includes(`${p}"`) && !text.includes(`${p}<`) && !text.includes(`${p} `), `${name} carries the request path ${p}`);
    assert.ok(!text.includes('"path"'), `${name} carries a path field`);
    for (const ua of [UA.urllib, UA.httpx, UA.claude, "Chrome/153"]) assert.ok(!text.includes(ua), `${name} carries a user agent`);
    assert.ok(!/\b173\b/.test(text), `${name} carries LanternKeeper's read count`);
    assert.ok(!text.includes("LanternKeeper"), `${name} carries an account login`);
  }
  // the one read column per household holds a bucket word and nothing else
  const d = JSON.parse(twinText);
  for (const h of d.households) assert.ok(["this week", "this month", "older", "never"].includes(h.last_read), h.last_read);
  for (const r of d.residents) assert.ok(["this week", "this month", "older", "never"].includes(r.household_last_read));
});

test("the privacy grep can fail: a page that printed a read count or a path would be caught", async () => {
  // FLIP: hand render() a model with a count and a path smuggled into a bucket
  const root = fresh();
  const fx = buildFixture(root);
  const M = await model(fx);
  M.households[0].last_read = `173 calls to ${PATHS[2]} `;
  const html = render(M);
  assert.ok(/\b173\b/.test(html) && html.includes(`${PATHS[2]} `), "the grep's targets must be findable when present");
});

// ── the hub ─────────────────────────────────────────────────────────────────
function hubWith(activityTwin) {
  const opsRoot = fresh();
  if (activityTwin !== undefined) {
    mkdirSync(join(opsRoot, "activity"), { recursive: true });
    writeFileSync(join(opsRoot, "activity", "data.json"), typeof activityTwin === "string" ? activityTwin : JSON.stringify(activityTwin));
  }
  execFileSync(process.execPath, [HUB], { encoding: "utf8", env: { ...process.env, OPS_ROOT: opsRoot } });
  const html = readFileSync(join(opsRoot, "index.html"), "utf8");
  const at = html.indexOf('<a class="card" href="activity/">');
  assert.ok(at >= 0, "the hub has an activity card");
  return { card: html.slice(at, html.indexOf("</a>", at)), roll: JSON.parse(readFileSync(join(opsRoot, "data.json"), "utf8")) };
}

test("the hub's activity card carries the number, the sparkline and a fresh chip", () => {
  const { twinText } = runCli();
  const d = JSON.parse(twinText);
  d.generated_at = new Date().toISOString(); // the fixture's clock is pinned; the hub reads the real one
  const { card, roll } = hubWith(d);
  assert.match(card, /<span class="c-val">4<\/span>/);
  assert.match(card, /residents acted in the last 7 days/);
  assert.match(card, /<svg class="spark"/);
  assert.match(card, /chip ok">fresh/);
  assert.equal(roll.dashboards.activity.freshness, "ok");
});

test("a missing or stale activity/data.json shows red on the hub like the others", () => {
  const missing = hubWith(undefined);
  assert.match(missing.card, /chip red">NO DATA/);
  assert.equal(missing.roll.dashboards.activity.freshness, "red");
  assert.ok(missing.roll.not_fresh.includes("activity"));

  const { twinText } = runCli();
  const d = JSON.parse(twinText);
  d.generated_at = new Date(Date.now() - 3 * 864e5).toISOString();
  const stale = hubWith(d);
  assert.match(stale.card, /chip red">STALE · 3d old/);
  assert.equal(stale.roll.dashboards.activity.freshness, "red");

  const broken = hubWith("{not json");
  assert.match(broken.card, /chip red">NO DATA/);
});
