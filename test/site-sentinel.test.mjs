// Falsifiers for site-sentinel.
//
// The law these assert is the founder's sentence of 2026-08-25, quoted verbatim
// wherever a test claims the alert fires:
//
//     "how can we LOUDLY BE NOTIFIED when something is down on the site?"
//
// Two sentences that shape what "loud" has to mean here, and which several of
// these tests exist specifically to hold:
//   - loud is not frequent. A per-tick ping is wallpaper; the reader mutes it,
//     and a muted channel reproduces the silence exactly. So the reminder
//     falsifier below is as load-bearing as the onset one.
//   - degrading must be visible. A watch that cannot reach its channel must
//     still take every reading, still write its board, and still SAY so.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  classifyUp,
  classifyStamp,
  classifyCrossing,
  classifyDaily,
  dailyFingerprint,
  normalizeText,
  latestDecisiveRunPerWorkflow,
  classifyWorkflows,
  transition,
  composeMessage,
  composeBoard,
  alertingStatus,
  humanDuration,
  lsRemote,
  newestReleaseTag,
  tick,
  run,
  classifyProblems,
  MINUTE,
  HOUR,
  CONFIG,
} from "../tools/site-sentinel.mjs";

const T0 = Date.parse("2026-08-25T12:00:00Z");

// ── §1 up ───────────────────────────────────────────────────────────────────

test("classifyUp: 200 is up, 500 and a timeout and a 404 are all DOWN", () => {
  assert.equal(classifyUp({ status: 200 }).verdict, "OK");
  assert.equal(classifyUp({ status: 204 }).verdict, "OK");

  // 5xx — the server broke.
  const five = classifyUp({ status: 502 });
  assert.equal(five.verdict, "DOWN");
  assert.match(five.reason, /502/);

  // No response at all. This is the loudest case and must not be softened by a
  // sympathetic error string.
  const dead = classifyUp({ error: "The operation was aborted due to timeout" });
  assert.equal(dead.verdict, "DOWN");
  assert.match(dead.reason, /did not answer at all/);
  assert.equal(classifyUp({ error: "ECONNREFUSED" }).verdict, "DOWN");

  // 404 on a path that is supposed to exist is an outage wearing a tidy status
  // code — a deploy that shipped a tree without /daily/ looks exactly like this.
  assert.equal(classifyUp({ status: 404 }).verdict, "DOWN");
});

test("classifyUp: dev's 302 to the Access login is INFO, and a 302 anywhere else is still DOWN", () => {
  const gate = "https://raspy-frog-75d3.cloudflareaccess.com/cdn-cgi/access/login/dev.postmark.town?kid=abc";

  // dev.postmark.town's healthy shape — measured against the live host
  // 2026-08-25. Alarming on it would train the reader to ignore the channel,
  // which is the failure mode this whole file is against.
  const dev = classifyUp({ status: 302, location: gate, infoOnly: true });
  assert.equal(dev.verdict, "INFO");
  assert.match(dev.reason, /Access/);

  // THE CONTROL, and the reason the gate is recognised by DESTINATION HOST and
  // not by status code: a 302 that is NOT the Access login must not be
  // swallowed by the same branch, or a redirect loop on prod reads as healthy.
  const elsewhere = classifyUp({ status: 302, location: "https://example.com/oops" });
  assert.equal(elsewhere.verdict, "DOWN");
  assert.match(elsewhere.reason, /should serve, not redirect/);

  // And an info-only door that is genuinely dead still cannot raise an alert —
  // it reports, it does not alarm.
  assert.equal(classifyUp({ error: "ECONNREFUSED", infoOnly: true }).verdict, "INFO");
  assert.equal(classifyUp({ status: 500, infoOnly: true }).verdict, "INFO");
});

// ── §2/§3 the staleness math, against fixed fixtures ────────────────────────

test("classifyStamp: matching is OK, a fresh divergence is inside the window, a held one is STALE", () => {
  const base = { nowMs: T0, staleAfterMs: 45 * MINUTE, what: "the index", referenceName: "main" };

  // Agreement is green regardless of clocks — and clears the divergence memory.
  const ok = classifyStamp({ ...base, served: "aaa", reference: "aaa", seen: { value: "aaa", first_seen_at: T0 - 2 * HOUR, diverged_since: T0 - 30 * MINUTE } });
  assert.equal(ok.verdict, "OK");
  assert.equal(ok.seen.diverged_since, null, "agreement must clear the divergence clock, or a healed site stays pre-condemned");

  // Diverged ten minutes ago: an ordinary deploy in flight.
  const fresh = classifyStamp({ ...base, served: "aaa", reference: "bbb", seen: { value: "aaa", first_seen_at: T0 - 2 * HOUR, diverged_since: T0 - 10 * MINUTE } });
  assert.equal(fresh.verdict, "OK");
  assert.match(fresh.reason, /inside the 45m deploy window/);

  // The reference has been ahead for over an hour — the stuck rehydrate tick,
  // the shape found by hand on 2026-08-25 (one distinct as-of across three
  // tick slots). This is what "something is down" looks like with no error code.
  const stale = classifyStamp({ ...base, served: "aaa", reference: "bbb", seen: { value: "aaa", first_seen_at: T0 - 2 * HOUR, diverged_since: T0 - 70 * MINUTE } });
  assert.equal(stale.verdict, "STALE");
  assert.match(stale.reason, /1h10m/);
  assert.match(stale.reason, /moved on/);
});

test("classifyStamp: THE QUIET-HOUR INCIDENT (2026-08-31, 6-7 false alarms a day) — an old serve of a quiet repo is not stale", () => {
  // The exact live shape, replayed: the town committed nothing for 59 minutes,
  // so the served sha aged 49 minutes in perfect health; then one stake landed
  // and NINE minutes later the old anchoring declared 49 minutes of staleness.
  // The clock must start at the divergence, not at the served value's birth.
  const base = { nowMs: T0, staleAfterMs: 45 * MINUTE, what: "the index", referenceName: "main" };
  // Every quiet tick agreed, so the memory carries no divergence...
  const quiet = { value: "8216f1ce", first_seen_at: T0 - 49 * MINUTE, diverged_since: null };
  // ...and the first tick that sees the fresh push starts the clock NOW.
  const v = classifyStamp({ ...base, served: "8216f1ce", reference: "1cf42d0d", seen: quiet });
  assert.equal(v.verdict, "OK", "nine minutes behind a nine-minute-old tip is a deploy in flight, never an alarm");
  assert.equal(v.seen.diverged_since, T0, "the divergence clock starts at the divergence");
  // Had the push stayed unserved past the window, THEN it alarms:
  const later = classifyStamp({ ...base, nowMs: T0 + 50 * MINUTE, served: "8216f1ce", reference: "1cf42d0d", seen: v.seen });
  assert.equal(later.verdict, "STALE", "…and a divergence genuinely held past the window still fires");
});

test("classifyStamp: the divergence clock survives reference movement, so a busy repo cannot hide a frozen site", () => {
  // The original anchoring law, kept under the new anchor: if the clock reset
  // whenever the reference moved, a repo that commits every 30 minutes could
  // never accumulate an alarm even while every single deploy failed.
  const base = { nowMs: T0, staleAfterMs: 45 * MINUTE, what: "the index", referenceName: "main" };
  let seen = { value: "frozen", first_seen_at: T0 - 3 * HOUR, diverged_since: T0 - 3 * HOUR };

  // Reference keeps moving; served value does not. Still stale, every time.
  for (const reference of ["r1", "r2", "r3"]) {
    const v = classifyStamp({ ...base, served: "frozen", reference, seen });
    assert.equal(v.verdict, "STALE", `reference ${reference} must not reset the clock`);
    assert.equal(v.seen.diverged_since, T0 - 3 * HOUR, "the divergence memory must not advance while the served value is unchanged");
    seen = v.seen;
  }

  // And when the served value DOES change — a deploy landed — the clock resets:
  // a progressing pipeline is never stale.
  const moved = classifyStamp({ ...base, served: "thawed", reference: "r4", seen });
  assert.equal(moved.verdict, "OK");
  assert.equal(moved.seen.first_seen_at, T0);
  assert.equal(moved.seen.diverged_since, T0, "progress restarts the divergence clock");
});

test("classifyStamp: a pre-upgrade state file (no diverged_since) gets one tick of grace, not a false alarm", () => {
  const base = { nowMs: T0, staleAfterMs: 45 * MINUTE, what: "the index", referenceName: "main" };
  const old = { value: "aaa", first_seen_at: T0 - 2 * HOUR }; // written by the served-anchored era
  const v = classifyStamp({ ...base, served: "aaa", reference: "bbb", seen: old });
  assert.equal(v.verdict, "OK", "the watch does not know how long the divergence held — guessing would invent evidence");
  assert.equal(v.seen.diverged_since, T0);
});

test("classifyStamp: a cold start is quiet, and an unreadable side is UNKNOWN rather than green", () => {
  // Never-seen-before: the watch genuinely does not know how long that value
  // has been up. Guessing would be inventing evidence, so it starts the clock
  // and says OK this once.
  const cold = classifyStamp({ served: "aaa", reference: "bbb", seen: null, nowMs: T0, staleAfterMs: HOUR, what: "x", referenceName: "y" });
  assert.equal(cold.verdict, "OK");
  assert.equal(cold.seen.first_seen_at, T0);

  // An unreadable side must never read as green — a missing stamp is a blind
  // spot, and calling a blind spot healthy is the lie the whole file is against.
  assert.equal(classifyStamp({ served: null, reference: "b", seen: null, nowMs: T0, staleAfterMs: HOUR, what: "x", referenceName: "y" }).verdict, "UNKNOWN");
  assert.equal(classifyStamp({ served: "a", reference: null, seen: null, nowMs: T0, staleAfterMs: HOUR, what: "x", referenceName: "y" }).verdict, "UNKNOWN");
});

// ── §2b the crossing ────────────────────────────────────────────────────────
//
// THE LAW THESE ASSERT, verbatim from EPICS/POSTMARK/freshness-architecture.md
// § the mushy middle:
//
//   "mushiness must be disclosed — the page states when it was generated and
//    which ferry crossing it reflects, says 'a ferry has landed since this page
//    was made' when true, and never prints a cadence promise it does not
//    control."
//
// and, on why this probe exists at all beside the wall-clock ones:
//
//   "The crossing-aware watchdog: site-sentinel compares the site's crossing
//    number to reality's, instead of (only) a wall-clock age threshold — a
//    wall-clock threshold cannot see an event-shaped failure."
//
// THE DEFECT THEY CLOSE is the 2026-08-26 incident: prod's delivery stalled 97
// minutes past a ferry crossing and 48 residents' doorstep pages served
// yesterday's mail. Every wall-clock probe in this file was green throughout,
// because the site HAD rebuilt recently — it had just rebuilt the wrong side of
// a ferry. The first test below is that incident, to the minute.

// The town clock, in the falsifiers' own hands, so a test can place itself at
// an exact number of minutes past a crossing.
const CROSSING_AT = (n) => Date.parse("2026-06-12T00:00:00Z") + n * 12 * 60 * 60_000;

test("THE 08-26 INCIDENT: 97 minutes past a ferry with the site still on the old crossing is STALE, and says a ferry has landed", () => {
  const stale = classifyCrossing({
    servedCrossing: 148, officeCrossing: 149,
    nowMs: CROSSING_AT(149) + 97 * MINUTE, graceMs: CONFIG.crossingGrace,
  });
  assert.equal(stale.verdict, "STALE");
  assert.match(stale.reason, /a ferry has landed since the site was built/,
    "the founder's own sentence, said in the alert a reader actually gets");
  assert.match(stale.reason, /crossing 148/, "and it names the crossing the site is stuck on");
  assert.match(stale.reason, /1h37m/, "and how long the town has been past it");
});

test("THE FLIP: the same probe against a FRESH site is OK — it must not fire on a healthy town", () => {
  // caught up: the site baked the crossing the town is at
  const level = classifyCrossing({
    servedCrossing: 149, officeCrossing: 149,
    nowMs: CROSSING_AT(149) + 97 * MINUTE, graceMs: CONFIG.crossingGrace,
  });
  assert.equal(level.verdict, "OK", "a site showing the current crossing is never a finding");

  // and AHEAD is fine too: a build that straddled the ferry stamps the newer
  // number honestly, because the town data it read was on the far side of it.
  assert.equal(classifyCrossing({
    servedCrossing: 150, officeCrossing: 149,
    nowMs: CROSSING_AT(149) + 10 * MINUTE, graceMs: CONFIG.crossingGrace,
  }).verdict, "OK");
});

test("the rebuild window is TWO TICKS wide — quiet at :40, loud once both ticks have had their turn", () => {
  const one = (mins) => classifyCrossing({
    servedCrossing: 148, officeCrossing: 149,
    nowMs: CROSSING_AT(149) + mins * MINUTE, graceMs: CONFIG.crossingGrace,
  });
  // the :10 tick is still building
  assert.equal(one(12).verdict, "OK");
  assert.match(one(12).reason, /inside the 1h rebuild window/);
  // the :40 tick's turn — still inside
  assert.equal(one(45).verdict, "OK");
  // an hour on, both ticks have had their chance and neither landed
  assert.equal(one(61).verdict, "STALE");
});

test("two crossings behind is STALE whatever the clock says — no rebuild window excuses a whole missed ferry", () => {
  // one minute past a crossing is the most forgiving instant there is, and it
  // must still not forgive this: a full crossing came and went unseen.
  const said = classifyCrossing({
    servedCrossing: 147, officeCrossing: 149,
    nowMs: CROSSING_AT(149) + 1 * MINUTE, graceMs: CONFIG.crossingGrace,
  });
  assert.equal(said.verdict, "STALE");
  assert.match(said.reason, /2 ferries have landed/, "and it counts them, so the reader knows the size of the gap");
});

test("a crossing it cannot read is UNKNOWN and says which side went dark — never a green all-clear", () => {
  // Three different unreadables, three different repairs, three sentences. A
  // single "could not tell" would send the reader to the other probes to learn
  // which one it was, at the hour they are least able to.
  const noBuildJson = classifyCrossing({ haveStamp: false, servedCrossing: null, officeCrossing: 149, nowMs: CROSSING_AT(149), graceMs: CONFIG.crossingGrace });
  assert.equal(noBuildJson.verdict, "UNKNOWN");
  assert.match(noBuildJson.reason, /serves no \/build\.json at all/);

  const noStamp = classifyCrossing({ servedCrossing: null, officeCrossing: 149, nowMs: CROSSING_AT(149), graceMs: CONFIG.crossingGrace });
  assert.equal(noStamp.verdict, "UNKNOWN");
  assert.match(noStamp.reason, /build stamp names no crossing/);
  assert.notEqual(noStamp.reason, noBuildJson.reason,
    "a stamp that exists without a crossing is a DIFFERENT fix from no stamp at all");

  const noOffice = classifyCrossing({ servedCrossing: 149, officeCrossing: null, nowMs: CROSSING_AT(149), graceMs: CONFIG.crossingGrace });
  assert.equal(noOffice.verdict, "UNKNOWN");
  assert.match(noOffice.reason, /office did not serve a crossing number/);

  // THE FALSIFIER: folding "cannot tell" into "nothing is wrong" is the failure
  // that makes a sentinel worse than none — the reader is now trusting silence.
  for (const said of [noBuildJson, noStamp, noOffice]) assert.notEqual(said.verdict, "OK");
});

test("humanDuration reads inside a sentence", () => {
  assert.equal(humanDuration(30_000), "under a minute");
  assert.equal(humanDuration(45 * MINUTE), "45m");
  assert.equal(humanDuration(70 * MINUTE), "1h10m");
  assert.equal(humanDuration(3 * HOUR), "3h");
  assert.equal(humanDuration(26 * HOUR), "1d 2h");
});

// ── §4 the daily ────────────────────────────────────────────────────────────

const DAILY_MD = `<!-- Ferry's Daily -->
# The office — Ferry's Daily

*A curated look, tended each round; last on **2026-08-25**.*

### ⛴ **Crossing 149 · 45 letters over · no bounces**

## "An arithmetic that balances is not an arithmetic that agrees"

**The office told \`little-bird\` this week...**
`;

test("dailyFingerprint prefers the headline, which moves every tending, and falls back to the crossing line", () => {
  const fp = dailyFingerprint(DAILY_MD);
  assert.equal(fp.kind, "headline");
  assert.match(fp.value, /arithmetic that balances/);

  // No headline: the crossing line is the backstop. Second, not first, because
  // it only advances twice a day and is blind to a mid-crossing re-tending.
  const noHead = dailyFingerprint("# Daily\n\n### ⛴ **Crossing 150 · 3 letters**\n\ntext");
  assert.equal(noHead.kind, "crossing");
  assert.equal(noHead.value, "Crossing 150");

  assert.equal(dailyFingerprint("# nothing structural here").kind, "none");
});

test("normalizeText survives the markdown-to-HTML round trip that would otherwise report a stale daily every day", () => {
  // The same sentence, as authored and as rendered: smart quotes, an entity, a
  // tag boundary, an em-dash. Comparing raw bytes would call these different.
  const authored = `## "An arithmetic that balances" — really`;
  const rendered = `<h2 id="x">&#8220;An arithmetic that <em>balances</em>&#8221; &mdash; really</h2>`;
  assert.ok(normalizeText(rendered).includes(normalizeText("An arithmetic that balances")));
  assert.ok(normalizeText(authored).includes("an arithmetic that balances"));
});

test("classifyDaily: present is OK, absent-and-old is STALE, absent-and-fresh is the deploy window", () => {
  const fp = dailyFingerprint(DAILY_MD);
  const served = `<html><h1>The office — Ferry's Daily</h1><h2>&#8220;An arithmetic that balances is not an arithmetic that agrees&#8221;</h2></html>`;

  const ok = classifyDaily({ fingerprint: fp, servedHtml: served, sourceCommittedAtMs: T0 - 5 * HOUR, nowMs: T0, slackMs: 90 * MINUTE });
  assert.equal(ok.verdict, "OK");

  // The town moved five minutes ago; the site has not caught up yet. That is a
  // deploy in flight, not a failure, and alarming on it would make the channel
  // noise twice an hour.
  const inFlight = classifyDaily({ fingerprint: fp, servedHtml: "<html>yesterday's daily</html>", sourceCommittedAtMs: T0 - 5 * MINUTE, nowMs: T0, slackMs: 90 * MINUTE });
  assert.equal(inFlight.verdict, "OK");
  assert.match(inFlight.reason, /sync-and-deploy window/);

  // Past the window and still absent: "Ferry's Daily sat stale on display and
  // nobody was told" — the 2026-08-25 fire, caught as an OUTCOME with no
  // pipeline involved.
  const stale = classifyDaily({ fingerprint: fp, servedHtml: "<html>yesterday's daily</html>", sourceCommittedAtMs: T0 - 4 * HOUR, nowMs: T0, slackMs: 90 * MINUTE });
  assert.equal(stale.verdict, "STALE");
  assert.match(stale.reason, /newer Daily than the site is showing/);
  assert.match(stale.reason, /arithmetic that balances/, "the reason must quote the missing sentence so a reader can check it themselves");

  assert.equal(classifyDaily({ fingerprint: fp, servedHtml: null, nowMs: T0, slackMs: 90 * MINUTE }).verdict, "UNKNOWN");
});

// ── §5 workflows ────────────────────────────────────────────────────────────

test("latestDecisiveRunPerWorkflow looks through in-progress runs so a broken workflow cannot look clean while it runs", () => {
  const runs = [
    { name: "Sync Postmark atlas", status: "in_progress", conclusion: null, created_at: "T3" },
    { name: "Sync Postmark atlas", status: "completed", conclusion: "failure", created_at: "T2" },
    { name: "Sync Postmark atlas", status: "completed", conclusion: "success", created_at: "T1" },
    { name: "Deploy (snapshot -> dev, release -> prod)", status: "completed", conclusion: "success", created_at: "T2" },
  ];
  const latest = latestDecisiveRunPerWorkflow(runs);
  assert.equal(latest.get("Sync Postmark atlas").conclusion, "failure");
  assert.equal(latest.size, 2);
});

test("a cancellation ON TOP OF a failure must not turn the failure green — the live shape of 2026-08-25", () => {
  // ⚑ THE REGRESSION THIS EXISTS FOR. The first version of the probe took the
  // newest COMPLETED run and called `cancelled` healthy. Run against the live
  // town at 23:09Z on 2026-08-25 — with "Sync Postmark atlas" failing on every
  // run for hours — the newest completed run of BOTH workflows was a
  // cancellation, so the board came back all-green and the sentinel said
  // nothing whatsoever about the fire it was built for.
  //
  // "how can we LOUDLY BE NOTIFIED when something is down on the site?" — not
  // if a concurrency group can silence the answer.
  const runs = [
    { name: "Sync Postmark atlas", status: "completed", conclusion: "cancelled", created_at: "2026-08-25T22:41:34Z" },
    { name: "Sync Postmark atlas", status: "completed", conclusion: "failure", created_at: "2026-08-25T22:42:41Z", html_url: "https://x/runs/32907437534" },
    { name: "Deploy (snapshot -> dev, release -> prod)", status: "completed", conclusion: "cancelled", created_at: "2026-08-25T22:42:42Z" },
    { name: "Deploy (snapshot -> dev, release -> prod)", status: "completed", conclusion: "success", created_at: "2026-08-25T22:39:33Z" },
  ];
  const rows = classifyWorkflows(latestDecisiveRunPerWorkflow(runs));
  assert.equal(rows.find((r) => r.workflow.startsWith("Sync")).verdict, "DOWN", "the cancellation must be looked THROUGH to the failure beneath it");
  assert.equal(rows.find((r) => r.workflow.startsWith("Deploy")).verdict, "OK", "and looked through to the success beneath it, too — transparency both ways");
});

test("a red workflow is a finding EVEN WHEN every outcome is green — the 2026-08-25 shape, verbatim", () => {
  // On 2026-08-25 the site answered 200 everywhere and served the current
  // daily, while "Sync Postmark atlas" had failed on every run for hours. The
  // outcome probes were correct to say nothing. This probe is why the town
  // still finds out.
  const runs = [
    { name: "Sync Postmark atlas", status: "completed", conclusion: "failure", created_at: "2026-08-25T22:42:41Z", html_url: "https://github.com/x/y/actions/runs/32907437534" },
    { name: "Deploy (snapshot -> dev, release -> prod)", status: "completed", conclusion: "success", created_at: "2026-08-25T22:44:59Z" },
  ];
  const rows = classifyWorkflows(latestDecisiveRunPerWorkflow(runs));
  const sync = rows.find((r) => r.workflow.startsWith("Sync"));
  const deploy = rows.find((r) => r.workflow.startsWith("Deploy"));
  assert.equal(sync.verdict, "DOWN");
  assert.match(sync.reason, /32907437534/, "the reason must carry the run link, or the reader cannot go look");
  assert.equal(deploy.verdict, "OK", "the green sibling must stay green — this probe reports each workflow, it does not average them");
});

test("nothing but cancellations is UNKNOWN, never OK — 'nobody has checked' must not render as 'checked and fine'", () => {
  const rows = classifyWorkflows(latestDecisiveRunPerWorkflow([
    { name: "Sync Postmark atlas", status: "completed", conclusion: "cancelled", created_at: "T2" },
    { name: "Sync Postmark atlas", status: "completed", conclusion: "skipped", created_at: "T1" },
    { name: "Sync Postmark atlas", status: "in_progress", conclusion: null, created_at: "T3" },
  ]));
  const sync = rows.find((r) => r.workflow.startsWith("Sync"));
  assert.equal(sync.verdict, "UNKNOWN");
  assert.match(sync.reason, /nothing has been decided/);
  // And a workflow with no runs at all in the window is UNKNOWN too, never green.
  assert.equal(rows.find((r) => r.key === "workflow_deploy").verdict, "UNKNOWN");
});

// ── the edge-triggered machine ──────────────────────────────────────────────

test("LOUDLY BE NOTIFIED: the alert fires on the transition into bad, including a cold start into an outage", () => {
  // "how can we LOUDLY BE NOTIFIED when something is down on the site?"
  const onset = transition({ prev: { verdict: "OK", reason: "HTTP 200", since: T0 - HOUR, last_alert_at: null }, next: { verdict: "DOWN", reason: "HTTP 502" }, nowMs: T0 });
  assert.ok(onset.alert, "a good->bad transition MUST alert, or nothing is notified at all");
  assert.equal(onset.alert.kind, "onset");
  assert.equal(onset.state.since, T0);

  // A sentinel that boots into an existing outage and says nothing has failed
  // at its only job — so never-seen -> bad alerts too.
  const cold = transition({ prev: null, next: { verdict: "DOWN", reason: "HTTP 502" }, nowMs: T0 });
  assert.ok(cold.alert);
  assert.equal(cold.alert.kind, "onset");
});

test("no repeat alert within the reminder window, and exactly one when it elapses", () => {
  // Loud is not frequent. A ping every ten minutes is wallpaper, the reader
  // mutes the channel, and a muted channel reproduces the original silence.
  const bad = { verdict: "DOWN", reason: "HTTP 502", since: T0, last_alert_at: T0 };

  const soon = transition({ prev: bad, next: { verdict: "DOWN", reason: "HTTP 502" }, nowMs: T0 + 10 * MINUTE });
  assert.equal(soon.alert, null, "still bad ten minutes later must be SILENT");
  assert.equal(soon.state.since, T0, "the since-clock must survive the silence");
  assert.equal(soon.state.last_alert_at, T0, "and so must the last-alert clock, or the reminder never comes");

  const justUnder = transition({ prev: bad, next: { verdict: "DOWN", reason: "HTTP 502" }, nowMs: T0 + 12 * HOUR - MINUTE });
  assert.equal(justUnder.alert, null);

  const due = transition({ prev: bad, next: { verdict: "DOWN", reason: "HTTP 502" }, nowMs: T0 + 12 * HOUR });
  assert.equal(due.alert.kind, "reminder");
  assert.equal(due.state.last_alert_at, T0 + 12 * HOUR);

  // And the reminder does not restart: twelve hours after the REMINDER, not
  // twelve hours after the onset.
  const after = transition({ prev: due.state, next: { verdict: "DOWN", reason: "HTTP 502" }, nowMs: T0 + 13 * HOUR });
  assert.equal(after.alert, null);
});

test("recovery says so, and a change of failure is not the same failure", () => {
  const bad = { verdict: "DOWN", reason: "HTTP 502", since: T0, last_alert_at: T0 };

  const back = transition({ prev: bad, next: { verdict: "OK", reason: "HTTP 200" }, nowMs: T0 + 34 * MINUTE });
  assert.equal(back.alert.kind, "recovered");
  assert.equal(back.alert.downFor, 34 * MINUTE);
  assert.equal(back.state.last_alert_at, T0 + 34 * MINUTE);

  // DOWN becoming STALE is new information about what is wrong. Suppressing it
  // because "it was already bad" hides a change of failure behind a sameness of
  // mood.
  const changed = transition({ prev: bad, next: { verdict: "STALE", reason: "index frozen 2h" }, nowMs: T0 + HOUR });
  assert.equal(changed.alert.kind, "changed");
  assert.equal(changed.alert.from, "DOWN");
  assert.equal(changed.state.since, T0 + HOUR, "a different failure starts its own clock");
});

test("INFO and UNKNOWN never alert — an Access-gated door and an unreadable reference are not site outages", () => {
  assert.equal(transition({ prev: { verdict: "OK", since: T0 }, next: { verdict: "INFO", reason: "gated" }, nowMs: T0 }).alert, null);
  assert.equal(transition({ prev: null, next: { verdict: "UNKNOWN", reason: "GitHub did not answer" }, nowMs: T0 }).alert, null);
  // But going bad -> UNKNOWN must not silently read as recovered either.
  const murky = transition({ prev: { verdict: "DOWN", reason: "502", since: T0, last_alert_at: T0 }, next: { verdict: "UNKNOWN", reason: "unreadable" }, nowMs: T0 + HOUR });
  assert.equal(murky.alert, null);
  assert.equal(murky.state.verdict, "UNKNOWN");
});

// ── the message and the board ───────────────────────────────────────────────

test("the Discord message is plain prose with no markdown table, and names what/since/why", () => {
  const board = composeBoard({ probes: [{ key: "a", label: "x", verdict: "DOWN", reason: "r" }], nowIso: "2026-08-25T12:00:00Z", alerting: {} });
  const msg = composeMessage({
    nowIso: "2026-08-25T12:00:00Z",
    board,
    alerts: [
      { label: "the Daily page", alert: { kind: "onset", verdict: "DOWN", reason: "HTTP 502 — the server broke", since: T0 - 20 * MINUTE } },
      { label: "the office's read index", alert: { kind: "recovered", verdict: "OK", reason: "matches main", since: T0 - HOUR, downFor: 90 * MINUTE } },
    ],
  });
  // Discord renders markdown tables as garbage, so the loudest message must
  // never be the least readable one.
  assert.ok(!msg.includes("|---"), "no markdown table separators");
  assert.ok(!/^\s*\|/m.test(msg), "no markdown table rows");
  assert.match(msg, /DOWN — the Daily page: HTTP 502/);
  assert.match(msg, /RECOVERED — the office's read index is healthy again after 1h30m/);

  assert.equal(composeMessage({ alerts: [], board, nowIso: "x" }), null, "nothing to say means nothing is sent");
});

test("the board carries one headline line the operator round can read without reducing the array itself", () => {
  const probes = [
    { key: "a", label: "home", verdict: "OK", reason: "HTTP 200" },
    { key: "b", label: "daily", verdict: "DOWN", reason: "HTTP 502" },
    { key: "c", label: "dev", verdict: "INFO", reason: "gated" },
  ];
  const board = composeBoard({ probes, nowIso: "2026-08-25T12:00:00Z", alerting: { configured: true } });
  assert.equal(board.status, "DOWN");
  assert.match(board.headline, /^DOWN · /);
  assert.equal(board.counts.OK, 1);
  assert.equal(board.probes.length, 3);

  assert.equal(composeBoard({ probes: [{ verdict: "OK" }, { verdict: "STALE" }], nowIso: "x", alerting: {} }).status, "STALE");
  assert.equal(composeBoard({ probes: [{ verdict: "OK" }, { verdict: "UNKNOWN" }], nowIso: "x", alerting: {} }).status, "DEGRADED");
  assert.equal(composeBoard({ probes: [{ verdict: "OK" }, { verdict: "INFO" }], nowIso: "x", alerting: {} }).status, "OK");
});

// ── the whole tick, and the loud degradation ────────────────────────────────

/**
 * A fetch stub that answers by URL prefix, LONGEST PREFIX WINS.
 *
 * The "longest" is not a nicety — the first version matched in insertion order,
 * so `https://postmark.town/` shadowed `https://postmark.town/daily/` and every
 * outage this file installs on the Daily page came back green. The apparatus
 * needs its own falsifier as much as the code does.
 *
 * Anything unlisted 404s through the probe path rather than throwing, so a test
 * that forgets a door gets a legible verdict instead of a stack trace.
 */
function stubFetch(table) {
  return async (url) => {
    const hit = Object.entries(table)
      .filter(([k]) => String(url).startsWith(k))
      .sort((a, b) => b[0].length - a[0].length)[0];
    const r = hit ? hit[1] : { status: 404, body: "" };
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: { get: (h) => (r.headers ?? {})[String(h).toLowerCase()] ?? null },
      text: async () => r.body ?? "",
      json: async () => JSON.parse(r.body ?? "null"),
    };
  };
}

const GREEN_TABLE = {
  // T0 is 2026-08-25T12:00:00Z, which IS the start of crossing 149 (the town
  // clock: 12h since 2026-06-12) — the same crossing DAILY_MD above names, so
  // the whole green fixture describes one coherent moment in the town.
  "https://postmark.town/api/": { status: 200, headers: { "x-postmark-as-of": "towntip0000" }, body: JSON.stringify({ crossing: { number: 149 } }) },
  "https://postmark.town/build.json": { status: 200, body: JSON.stringify({ channel: "release", code_sha: "relsha00000", town_data_sha: "sitetip0000", crossing: 149 }) },
  "https://postmark.town/daily/ferrys-daily.html": { status: 200, body: `<h2>"An arithmetic that balances is not an arithmetic that agrees"</h2>` },
  "https://raw.githubusercontent.com/postmark-town/postmark/main/TOWN_BULLETIN/ferrys-daily.md": { status: 200, body: DAILY_MD },
  "https://api.github.com/repos/postmark-town/postmark/commits": { status: 200, body: JSON.stringify([{ commit: { committer: { date: "2026-08-25T06:00:00Z" } } }]) },
  "https://api.github.com/repos/keeminlee/postmark-site/actions/runs": {
    status: 200,
    body: JSON.stringify({ workflow_runs: [
      { name: "Sync Postmark atlas", status: "completed", conclusion: "success", created_at: "2026-08-25T11:42:00Z" },
      { name: "Deploy (snapshot -> dev, release -> prod)", status: "completed", conclusion: "success", created_at: "2026-08-25T11:44:00Z" },
    ] }),
  },
  "https://postmark.town/": { status: 200, body: "<html/>" },
  "https://dev.postmark.town/": { status: 302, headers: { location: "https://x.cloudflareaccess.com/cdn-cgi/access/login/dev.postmark.town" }, body: "" },
};

// git ls-remote, stubbed: main tip, then the release tag list.
const stubExec = ({ siteTip = "sitetip0000", townTip = "towntip0000", relSha = "relsha00000" } = {}) =>
  (_bin, args) => {
    const repo = args.find((a) => a.startsWith("https://")) ?? "";
    if (args.includes("--tags")) return `${relSha}\trefs/tags/release/2026-w35.1\n`;
    return repo.includes("postmark-site") ? `${siteTip}\trefs/heads/main\n` : `${townTip}\trefs/heads/main\n`;
  };

// §6 fixture: a real temp state file with a fresh mtime, so the healthy tick
// exercises the watcher probe instead of skipping it, and a config that points
// the sentinel at it rather than at the box's /srv paths.
import { writeFileSync as _wf } from "node:fs";
import { CONFIG as _CFG } from "../tools/site-sentinel.mjs";
const _wdir = mkdtempSync(join(tmpdir(), "sentinel-watcher-"));
const _wstate = join(_wdir, "state.json");
_wf(_wstate, "{}");
import { utimesSync as _ut } from "node:fs";
// pin the mtime relative to the tests' fixed clock, so the probe's verdict is
// deterministic instead of riding the wall clock the rest of the suite avoids
_ut(_wstate, new Date((T0 - 5 * 60_000)), new Date((T0 - 5 * 60_000)));
// §7 fixture, same discipline: a real temp report with a published outcome, so
// the healthy tick EXERCISES the refresh probe rather than skipping it — and so
// the suite does not read /srv/postmark-harbor/site-refresh.json, whose verdict
// would otherwise ride whatever the box last published. This suite runs on the
// box too.
const _rrep = join(_wdir, "site-refresh.json");
_wf(_rrep, JSON.stringify({
  at: new Date(T0 - 4 * 60_000).toISOString(),
  status: "published",
  town_sha: "9468d6e3419b1c6b03d10c82cd19ff6c0a1917a4",
  site_main: "26d75407b7cc9bfb7bf79008a23380d217939d49",
  release_tag: "release/2026-w38.2",
  published: "/srv/postmark-site-refresh/releases/20260917T081659Z-9468d6e3",
  passes: 2,
  detail: "converged after 2 pass(es) at town 9468d6e3",
}, null, 1));
const FIXTURE_CONFIG = {
  ..._CFG,
  watchers: [{ key: "usdc_watch", label: "the usdc-watch timer", state: _wstate, cadenceMs: 6 * 60 * 60_000 }],
  siteRefresh: { ..._CFG.siteRefresh, report: _rrep, cadenceMs: 6 * 60 * 60_000 },
};
// cadence is 6h IN THE FIXTURE ONLY: the LOUDLY test advances its clock ~1h to
// exercise held-alert semantics, and the watcher must stay inside its window
// across that whole timeline — its own verdicts are covered by the four
// classifyWatcher tests above, not by riding along here.

test("a healthy tick is entirely green and says nothing", async () => {
  const { probes, alerts } = await tick({ fetchImpl: stubFetch(GREEN_TABLE), exec: stubExec(), state: {}, nowMs: T0, config: FIXTURE_CONFIG });
  const bad = probes.filter((p) => p.verdict !== "OK" && p.verdict !== "INFO");
  assert.deepEqual(bad.map((p) => `${p.key}:${p.verdict} ${p.reason}`), [], "a green town must produce no findings");
  assert.equal(alerts.length, 0, "and therefore nothing to say");
});

test("LOUDLY BE NOTIFIED: an outage and a frozen index both surface from one tick, with reasons a reader can act on", async () => {
  // "how can we LOUDLY BE NOTIFIED when something is down on the site?"
  const broken = {
    ...GREEN_TABLE,
    "https://postmark.town/daily/": { status: 502, body: "" },
    // the office answers, but with an index that has not moved
    "https://postmark.town/api/": { status: 200, headers: { "x-postmark-as-of": "frozen00000" }, body: "{}" },
  };
  const state = { probes: {}, stamps: { office_as_of: { value: "frozen00000", first_seen_at: T0 - 2 * HOUR, diverged_since: T0 - 2 * HOUR } } };
  const { probes, alerts } = await tick({ fetchImpl: stubFetch(broken), exec: stubExec(), state, nowMs: T0, config: FIXTURE_CONFIG });

  const daily = probes.find((p) => p.key === "site_daily");
  assert.equal(daily.verdict, "DOWN");
  const index = probes.find((p) => p.key === "office_as_of");
  assert.equal(index.verdict, "STALE");
  assert.match(index.reason, /2h/);

  const keys = alerts.map((a) => a.key).sort();
  assert.deepEqual(keys, ["office_as_of", "site_daily"], "both must alert, and nothing else may");
});

test("env-missing degrades LOUDLY: every reading is still taken, the board is still written, and it says nothing was sent", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sentinel-degrade-"));
  const statePath = join(dir, "state.json");
  const outPath = join(dir, "status.json");
  const errs = [];

  const { board, message } = await run({
    argv: ["node", "site-sentinel.mjs", "--state", statePath, "--out", outPath],
    env: {},                       // no SENTINEL_DISCORD_WEBHOOK, no token file
    fetchImpl: stubFetch({ ...GREEN_TABLE, "https://postmark.town/daily/": { status: 502, body: "" } }),
    exec: stubExec(),
    nowMs: T0,
    log: () => {},
    errLog: (m) => errs.push(String(m)),
  });

  // It said so, out loud, on stderr.
  assert.ok(errs.some((e) => /LOUD DEGRADATION/.test(e) && /SENTINEL_DISCORD_WEBHOOK/.test(e)), "stderr must name the missing variable");
  // The alert text is not lost — an undeliverable alert still reaches the journal.
  assert.ok(errs.some((e) => /DOWN — the Daily page/.test(e)), "the undelivered alert must still be printed in full");
  assert.ok(message.includes("DOWN"));

  // Every reading was still taken, and the board still landed on disk.
  assert.ok(existsSync(outPath), "the board must be written even with no channel");
  const written = JSON.parse(readFileSync(outPath, "utf8"));
  assert.equal(written.status, "DOWN");
  assert.equal(written.alerting.configured, false);
  assert.match(written.alerting.note, /SENTINEL_DISCORD_WEBHOOK is unset/);
  assert.match(written.alerting.note, /NOTHING WAS SENT/, "the board itself must say the channel was silent, or a reader trusts a board nobody was told about");
  assert.ok(written.probes.length >= 8);

  // And the state advanced, so the next tick does not re-announce this onset.
  const st = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(st.probes.site_daily.verdict, "DOWN");
  assert.equal(st.probes.site_daily.last_alert_at, T0);
});

test("alertingStatus is data, not a side effect", () => {
  assert.equal(alertingStatus({ SENTINEL_DISCORD_WEBHOOK: "https://discord.com/api/webhooks/x" }).status.configured, true);
  assert.equal(alertingStatus({}).status.configured, false);
  assert.equal(alertingStatus({ SENTINEL_DISCORD_WEBHOOK: "" }).status.configured, false, "an empty string is not a channel");
});

test("no /build.json means UNKNOWN and a note naming the fix — never a green site-freshness verdict", async () => {
  const noStamp = { ...GREEN_TABLE };
  delete noStamp["https://postmark.town/build.json"];
  const { probes, notes } = await tick({ fetchImpl: stubFetch(noStamp), exec: stubExec(), state: {}, nowMs: T0 });
  assert.equal(probes.find((p) => p.key === "site_code").verdict, "UNKNOWN");
  assert.equal(probes.find((p) => p.key === "site_town_data").verdict, "UNKNOWN");
  assert.ok(notes.some((n) => /build-stamp\.mjs/.test(n)), "the note must name where the fix lives");
});

test("prod's code is compared against the RELEASE TAG, not main — lagging main is the design, not an outage", async () => {
  // deploy.yml's release lane checks out the newest release/* tag and builds
  // code from there. Comparing that code against main's tip would report a
  // permanent, meaningless STALE and teach the reader to ignore the channel.
  const exec = stubExec({ siteTip: "mainmoved00", relSha: "relsha00000" });
  // Both halves are seeded as long-held: a cold start is quiet by design, so a
  // test that wants the STALE branch must supply the memory that earns it.
  const state = { stamps: {
    site_code: { value: "relsha00000", first_seen_at: T0 - 5 * HOUR, diverged_since: T0 - 5 * HOUR },
    site_town_data: { value: "sitetip0000", first_seen_at: T0 - 5 * HOUR, diverged_since: T0 - 5 * HOUR },
  } };
  const { probes } = await tick({ fetchImpl: stubFetch(GREEN_TABLE), exec, state, nowMs: T0 });

  const code = probes.find((p) => p.key === "site_code");
  assert.equal(code.verdict, "OK", "code pinned to the newest release tag is correct, however far main has run ahead");
  assert.match(code.reason, /release tag/);

  // THE CONTROL: the town-data half of the same stamp IS compared against main,
  // and it is the half that froze on 2026-08-24 ("prod served Crossing 144
  // while main carried 146") behind a correctly-pinned code sha.
  const data = probes.find((p) => p.key === "site_town_data");
  assert.equal(data.verdict, "STALE");
  assert.match(data.reason, /main/);
});

test("lsRemote and newestReleaseTag read the wire protocol, and answer null rather than throwing", () => {
  const exec = () => "abc123\trefs/heads/main\n";
  assert.equal(lsRemote("https://x/y.git", "main", { exec }), "abc123");

  const tags = () => [
    "s1\trefs/tags/release/2026-w34",
    "s2\trefs/tags/release/2026-w35.1",
    "s3\trefs/tags/release/2026-w35",
  ].join("\n") + "\n";
  const newest = newestReleaseTag("https://x/y.git", { exec: tags });
  assert.equal(newest.tag, "release/2026-w35.1", "numeric-aware sort, so w35.1 beats w35 and w34");

  // THE ANNOTATED-TAG CASE (2026-08-26, caught live): the wire lists the tag
  // object AND its peeled commit; the deploy checks out the COMMIT, so the
  // probe must answer the peeled sha or it calls a current site stale — which
  // it did, for 9 hours, the morning after release/2026-w35.3 shipped.
  const annotated = () => [
    "tagobj35_3\trefs/tags/release/2026-w35.3",
    "commit35_3\trefs/tags/release/2026-w35.3^{}",
    "s2\trefs/tags/release/2026-w35.1",
  ].join("\n") + "\n";
  const peeled = newestReleaseTag("https://x/y.git", { exec: annotated });
  assert.equal(peeled.tag, "release/2026-w35.3", "the peeled line must not create a phantom second tag");
  assert.equal(peeled.sha, "commit35_3", "an annotated tag answers its PEELED commit, never the tag object");

  const boom = () => { throw new Error("no network"); };
  assert.equal(lsRemote("https://x/y.git", "main", { exec: boom }), null, "an unreachable remote is UNKNOWN upstream, not a crash");
  assert.equal(newestReleaseTag("https://x/y.git", { exec: boom }), null);
});

// ── §6: the watchers' own pulse (added 2026-08-26 after the EACCES crashloop) ──
// The founder's sentence, which these assert: "how can we LOUDLY BE NOTIFIED
// when something is down" — and on 2026-08-26 usdc-watch crash-looped on
// EACCES for 22 hours behind an all-green board, because no probe asked
// whether the watchers themselves were alive.
import { classifyWatcher } from "../tools/site-sentinel.mjs";

test("an enabled watcher with NO state file is DOWN — a crashloop, never a quiet rail", () => {
  const r = classifyWatcher({ exists: false, nowMs: 1000, cadenceMs: 600_000, label: "the usdc-watch timer" });
  assert.equal(r.verdict, "DOWN");
  assert.match(r.reason, /never run or cannot write/);
});

test("a watcher silent past 3x its cadence is STALE", () => {
  const now = 10_000_000;
  const r = classifyWatcher({ exists: true, mtimeMs: now - 31 * 60_000, nowMs: now, cadenceMs: 600_000, label: "the usdc-watch timer" });
  assert.equal(r.verdict, "STALE");
});

test("a watcher inside its cadence window is OK", () => {
  const now = 10_000_000;
  const r = classifyWatcher({ exists: true, mtimeMs: now - 8 * 60_000, nowMs: now, cadenceMs: 600_000, label: "the usdc-watch timer" });
  assert.equal(r.verdict, "OK");
});

test("an UNADOPTED Stage-B watcher is INFO — parked is not broken", () => {
  const r = classifyWatcher({ adopted: false, exists: false, nowMs: 1000, cadenceMs: 600_000, label: "the stripe-watch timer" });
  assert.equal(r.verdict, "INFO");
});


// ── §6b: the watch's expectation must match the unit it watches ─────────────

test("every watcher's expected cadence is the cadence its own shipped timer fires at", () => {
  // LAW (tools/site-sentinel.mjs § classifyWatcher, verbatim): a watcher is
  //     STALE when it "last wrote its state ${...} min ago against a ${...}-min
  //     cadence". The sentence is only true if the number it quotes is the
  //     number the unit actually uses.
  //
  // THE DRIFT THIS CAUGHT, live on this branch: stripe_watch was configured at
  // a 10-minute cadence while deploy/postmark-stripe-watch.timer has always
  // fired `OnCalendar=*:7/15`. The tolerance is 3× the cadence, so the watch
  // allowed 30 minutes for a rail that ticks every 15 — ONE missed tick short
  // of alarming, and the reason line it would print names a cadence the box
  // does not run. A probe that cries wolf is a probe the reader mutes, and a
  // muted channel is the silent failure this whole file exists to end.
  //
  // Reading the unit rather than a second constant is the point: these two
  // numbers live in different files and nothing but this test makes them agree.
  const OFFICE = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  for (const w of _CFG.watchers ?? []) {
    assert.ok(w.unit, `${w.key} names the unit it watches`);
    const unitPath = join(OFFICE, "deploy", w.unit);
    assert.ok(existsSync(unitPath), `${w.unit} is a unit this repo ships`);
    const unit = readFileSync(unitPath, "utf8");
    const m = unit.match(/^OnCalendar=\*:(\d+)\/(\d+)\s*$/m);
    assert.ok(m, `${w.unit} declares an OnCalendar this test can read`);
    const everyMin = Number(m[2]);
    assert.equal(
      w.cadenceMs, everyMin * 60_000,
      `${w.key} expects ${Math.round(w.cadenceMs / 60_000)} min but ${w.unit} fires every ${everyMin} min`,
    );
  }
});


test("a probe PARKED BY DESIGN is admitted in the one line the operator reads", () => {
  // LAW (tools/site-sentinel.mjs § the board, verbatim, on the summary field):
  //     "The one line the operator round reads. Kept as its own field so a
  //     reader never has to reduce the array themselves and get a different
  //     answer."
  //
  // THE HOLE THIS CLOSES. `classifyWatcher` answers INFO for a Stage-B watcher
  // that was never adopted — correctly, because parked-by-design is not a
  // failure. But the summary said `All ${counts.OK} probes green.`, which
  // counted only the OK ones while the word "All" claimed the whole board. So a
  // rail that was built, shipped inert, and then forgotten reported as a clean
  // all-green tick forever — which is precisely the "staged inert, silently, for
  // good" failure the Stage-A/Stage-B split was designed to make impossible.
  //
  // A parked probe must never ALARM (that trains the reader to mute the
  // channel) and must never be INVISIBLE either. Counted, not alarmed.
  const probes = [
    { key: "a", label: "a public door", verdict: "OK", reason: "200" },
    { key: "stripe_watch", label: "the stripe-watch timer", verdict: "INFO", reason: "not adopted (Stage B parked) — nothing to watch yet" },
  ];
  const board = composeBoard({ probes, nowIso: "2026-08-27T12:00:00Z", alerting: {} });

  assert.equal(board.status, "OK", "parked by design is not a failure");
  assert.equal(board.counts.INFO, 1);
  assert.doesNotMatch(board.summary, /^All /, "'All' may not describe a board it did not count");
  assert.match(board.summary, /1 parked/, "the parked probe is named in the line that gets read");

  // and with nothing parked, the old sentence is untouched
  const clean = composeBoard({ probes: [{ key: "a", verdict: "OK" }], nowIso: "x", alerting: {} });
  assert.match(clean.summary, /^All 1 probes green\./);
});

test("a hand-run sentinel prints the parked rails too, not only the broken ones", () => {
  // Same hole, the other surface: the console loop skipped every verdict that
  // was not OK-or-INFO, so an operator running this by hand saw nothing at all
  // about a rail that had never been switched on. The board and the terminal
  // must agree about what is worth saying.
  const src = readFileSync(new URL("../tools/site-sentinel.mjs", import.meta.url), "utf8");
  assert.match(src, /PARKED/, "the console names parked probes");
});


// ── §7: the site refresh's OUTCOME (2026-09-17, postmark-town/postmark#2884) ─
//
// THE INSTANCE. At 08:12:35Z the box published a town with 48 doors missing,
// from a three-week-old committed snapshot. The board read 14 green at
// 08:20:02Z. Nothing on the board was wrong — nothing on it was looking at the
// refresh at all. The refresh writes its own report; this is the probe that
// reads it.
//
// THE REPORT'S SHAPE IS THE BOX'S, NOT ONE INVENTED HERE. Copied from
// /srv/postmark-harbor/site-refresh.json as it stood at 2026-09-17T08:10:00Z,
// which is the run of the instance itself:
//
//   { "at": "2026-09-17T08:10:00Z", "status": "published",
//     "town_sha": "9468d6e3...", "site_main": "26d75407...",
//     "release_tag": "release/2026-w38.2",
//     "published": "/srv/postmark-site-refresh/releases/20260917T081659Z-9468d6e3",
//     "passes": 2, "detail": "converged after 2 pass(es) at town 9468d6e3" }
//
// A STANDING FINDING THAT BELONGS BESIDE THESE TESTS: that report — the
// instance's OWN report — says `published`. The report is written once, at the
// end of a run, and a run whose first pass published short and whose second
// pass converged ends `published`. So THIS PROBE ALONE WOULD HAVE BEEN GREEN
// FOR THE 08:10Z RUN. It is postmark-site#97's exit that makes the pair work: a
// short fetch there dies the run at deploy/site-refresh.sh L428, `die` writes
// `report failed`, and this probe reads it. Neither half is the guard on its
// own, and this comment is here so nobody later reads this probe as one.

import { BAD, classifySiteRefresh } from "../tools/site-sentinel.mjs";

const REFRESH_LABEL = "the box's site refresh";
const CADENCE = 30 * MINUTE;
const NOW = Date.parse("2026-09-17T08:20:00Z");
const freshAt = (minAgo) => NOW - minAgo * MINUTE;
const boxReport = (over = {}) => ({
  at: "2026-09-17T08:10:00Z",
  status: "published",
  town_sha: "9468d6e3419b1c6b03d10c82cd19ff6c0a1917a4",
  site_main: "26d75407b7cc9bfb7bf79008a23380d217939d49",
  release_tag: "release/2026-w38.2",
  published: "/srv/postmark-site-refresh/releases/20260917T081659Z-9468d6e3",
  passes: 2,
  detail: "converged after 2 pass(es) at town 9468d6e3",
  ...over,
});
const classify = (over = {}, { atMinAgo = 10, ...rest } = {}) => classifySiteRefresh({
  exists: true,
  report: boxReport(over),
  atMs: freshAt(atMinAgo),
  mtimeMs: freshAt(atMinAgo),
  nowMs: NOW,
  cadenceMs: CADENCE,
  label: REFRESH_LABEL,
  ...rest,
});

test("§7 FAILED is DOWN, and the report's own detail is the reason VERBATIM", () => {
  // The detail is the sentence the founder reads on Discord and now in the
  // site's header popover, so it may not be summarised, reworded or truncated.
  const detail = "fetch-town.mjs tripped";
  const r = classify({ status: "failed", detail });
  assert.equal(r.verdict, "DOWN");
  assert.ok(r.reason.includes(detail), `the DOWN reason must CONTAIN the report's detail verbatim; got: ${r.reason}`);
  assert.equal(r.detail, detail, "and it rides onto the board so the site's popover can print it");
  assert.ok(BAD.has(r.verdict), "DOWN is in the sentinel's own BAD set, so this alerts and shows on the site");

  // a longer, real-shaped detail survives whole
  const long = "SNAPSHOT SHORT — residents.json keeps 134 rows; the checkout has 182 households; 48 doors are missing from /residents/ until the office answers";
  assert.ok(classify({ status: "failed", detail: long }).reason.includes(long));
});

test("§7 PUBLISHED is OK, and it names the release and how long ago", () => {
  const r = classify({ status: "published" }, { atMinAgo: 3 });
  assert.equal(r.verdict, "OK");
  assert.match(r.reason, /^published 20260917T081659Z-9468d6e3 3 min ago$/,
    `the release dir's own name, not the whole path; got: ${r.reason}`);
  assert.equal(r.detail, "converged after 2 pass(es) at town 9468d6e3");
});

test("§7 QUIET is OK — nothing moved is not nothing working", () => {
  const r = classify({ status: "quiet", published: "", detail: "nothing moved since the last build (town 9468d6e3, release/2026-w38.2)" }, { atMinAgo: 7 });
  assert.equal(r.verdict, "OK");
  assert.match(r.reason, /nothing to publish 7 min ago/);
  assert.match(r.reason, /nothing moved since the last build/);
});

test("§7 NO REPORT AT ALL is INFO — a fresh box is not a broken one", () => {
  const r = classifySiteRefresh({ exists: false, nowMs: NOW, cadenceMs: CADENCE, label: REFRESH_LABEL });
  assert.equal(r.verdict, "INFO");
  assert.ok(!BAD.has(r.verdict), "INFO never alerts — and composeBoard still counts it and names it as parked");
  assert.match(r.reason, /has written no report yet/);
});

test("§7 A STALE `published` IS NOT GREEN — three cadences and the publisher has stopped", () => {
  const ok = classify({}, { atMinAgo: 89 });
  assert.equal(ok.verdict, "OK", "89 minutes is inside three 30-minute cadences");
  const stale = classify({}, { atMinAgo: 91 });
  assert.equal(stale.verdict, "STALE", "91 is not");
  assert.ok(BAD.has(stale.verdict));
  assert.match(stale.reason, /91 min ago/);
  assert.match(stale.reason, /30-min cadence/);
  // AND IT SAYS WHICH STAMP IT MEASURED. An instrument that will not name what
  // it read cannot be checked against the thing it claims to have read.
  assert.match(stale.reason, /its own `at` stamp/);
  const byMtime = classifySiteRefresh({
    exists: true, report: boxReport({ at: "not a date" }),
    atMs: null, mtimeMs: freshAt(120), nowMs: NOW, cadenceMs: CADENCE, label: REFRESH_LABEL,
  });
  assert.equal(byMtime.verdict, "STALE");
  assert.match(byMtime.reason, /the report file's mtime/, "and when the stamp is unreadable it says it fell back");
});

test("§7 A FAILURE OUTRANKS ITS AGE, and the reason carries both clocks", () => {
  // A thing with two clocks needs two numbers (2026-08-25, (vvv)). The founder
  // needs "the last refresh failed"; the operator needs "and nothing has
  // reported since". One verdict, both facts, neither hiding the other.
  const r = classify({ status: "failed", detail: "the site build tripped" }, { atMinAgo: 240 });
  assert.equal(r.verdict, "DOWN", "a failure does not become merely stale by waiting");
  assert.match(r.reason, /the site build tripped/);
  assert.match(r.reason, /nothing has reported since — 240 min/);
});

test("§7 AN UNKNOWN STATUS WORD IS UNKNOWN, NEVER OK — nobody-has-checked must not render as checked-and-fine", () => {
  // The 2026-08-25 cancellation finding, in this file's own words: a value
  // meaning "nothing was decided" was mapped to OK, and the board went
  // all-green on the afternoon the atlas sync was failing on every tick.
  for (const status of ["running", "skipped", "", null, undefined, 0, "PUBLISHED"]) {
    const r = classify({ status });
    assert.equal(r.verdict, "UNKNOWN", `status ${JSON.stringify(status)} must not be read as healthy`);
    assert.match(r.reason, /read as unread rather than as healthy/);
  }
  assert.match(classify({ status: "running" }).reason, /"running"/, "and it quotes the word it actually saw");
  // UNKNOWN is not in BAD (it does not page, by this file's own doctrine) but
  // composeBoard turns it into DEGRADED and says so in the one line read.
  const board = composeBoard({ probes: [{ key: "site_refresh", verdict: "UNKNOWN", reason: "x" }], nowIso: "t", alerting: {} });
  assert.equal(board.status, "DEGRADED");
  assert.match(board.summary, /could not be read/);
});

test("§7 A HALF-WRITTEN REPORT IS UNKNOWN, and reading it throws nothing", () => {
  const r = classifySiteRefresh({ exists: true, report: null, readError: "Unexpected end of JSON input", nowMs: NOW, cadenceMs: CADENCE, label: REFRESH_LABEL });
  assert.equal(r.verdict, "UNKNOWN");
  assert.match(r.reason, /could not be read \(Unexpected end of JSON input\)/);
  assert.equal(r.detail, null);
});

test("§7 the expected cadence is the cadence the shipped timer fires at", () => {
  // Same law as §6b, and the same reason: the two numbers live in different
  // files and nothing but this test makes them agree. The refresh timer does
  // not use the `*:M/N` spelling the §6b reader parses — it is `OnCalendar=*:10,40`,
  // two marks an hour — so this derives the interval from the marks themselves.
  const OFFICE = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  const sr = _CFG.siteRefresh;
  assert.ok(sr, "the config declares the refresh it watches");
  assert.ok(sr.unit, "and names the unit the cadence comes from");
  const unitPath = join(OFFICE, "deploy", sr.unit);
  assert.ok(existsSync(unitPath), `${sr.unit} is a unit this repo ships`);
  const unit = readFileSync(unitPath, "utf8");
  const m = unit.match(/^OnCalendar=\*:([\d,]+)\s*$/m);
  assert.ok(m, `${sr.unit} declares an OnCalendar this test can read`);
  const marks = m[1].split(",").map(Number);
  assert.ok(marks.length >= 1 && marks.every((n) => Number.isInteger(n) && n >= 0 && n < 60), "the marks are minutes past the hour");
  assert.equal(sr.cadenceMs, (60 / marks.length) * 60_000,
    `the watch expects ${Math.round(sr.cadenceMs / 60_000)} min but ${sr.unit} fires ${marks.length} times an hour (${m[1]})`);
});

test("§7 the probe reaches the BOARD, with its detail, and its first tick says nothing", async () => {
  // End to end through `tick`, against a real temp report — the fixture config
  // above points the probe at it. Two things are asserted that a classifier
  // test cannot: that the probe is IN the probe list at all, and that `detail`
  // survives onto the board entry the site's popover reads.
  const { probes, alerts } = await tick({ fetchImpl: stubFetch(GREEN_TABLE), exec: stubExec(), state: {}, nowMs: T0, config: FIXTURE_CONFIG });
  const p = probes.find((x) => x.key === "site_refresh");
  assert.ok(p, "the refresh probe is on the board, beside usdc_watch");
  assert.equal(p.kind, "refresh");
  assert.equal(p.verdict, "OK");
  assert.equal(p.detail, "converged after 2 pass(es) at town 9468d6e3", "the report's detail rides onto the board entry");
  assert.ok(!alerts.some((a) => a.key === "site_refresh"),
    "FIRST TICK, HEALTHY: transition() takes its `prev == null && !alertable` branch and says nothing");

  // and the other side of that same branch: never-seen -> bad DOES fire, because
  // a sentinel that boots into an outage and stays quiet has failed at its job.
  const onset = transition({ prev: null, next: { key: "site_refresh", verdict: "DOWN", reason: "failed: fetch-town.mjs tripped" }, nowMs: T0 });
  assert.equal(onset.alert.kind, "onset");
});

test("§7 the new probe's line reads as a SENTENCE in the Discord message", () => {
  // composeMessage prints `${verdict} — ${label}: ${reason}.` and the label and
  // reason were written to sit in that frame rather than beside it.
  const msg = composeMessage({
    alerts: [{
      key: "site_refresh",
      label: REFRESH_LABEL,
      alert: { kind: "onset", verdict: "DOWN", reason: classify({ status: "failed", detail: "fetch-town.mjs tripped" }).reason, since: NOW },
    }],
    board: { summary: "1 down, 0 stale, 14 green.", published_at: "/srv/postmark-sentinel/status.json" },
    nowIso: "2026-09-17T08:20:00Z",
  });
  assert.match(msg, /DOWN — the box's site refresh: the box's site refresh failed: fetch-town\.mjs tripped\./);
});

// ── §2c the build that published WITH problems (POS-180, 2026-09-21) ────────
//
// Keemin, 2026-09-21: "Could we just let the site publish, but have the
// postmark sentinel bark about the 404?" This is the bark.
//
// The site half (postmark-site POS-180) stops a single named entity's 404 from
// freezing the whole town: the build publishes, the shed thing leaves, a 404'd
// resident keeps the row they had, and the build writes down what it could not
// get. That record only becomes actionable if something reads it — and until
// POS-180 `problems` was assembled by the site's fetch and written to a build
// log nobody reads on a schedule. These falsifiers hold the reading end.

test("a build.json carrying problems REDS the sentinel — a published-with-problems build is a finding", () => {
  const table = {
    ...GREEN_TABLE,
    "https://postmark.town/build.json": {
      status: 200,
      body: JSON.stringify({
        channel: "release", code_sha: "relsha00000", town_data_sha: "sitetip0000", crossing: 149,
        problems: ['residents: the roll named "wright" and the card door answered 404 — the row is HELD OVER'],
      }),
    },
  };
  const p = classifyProblems({ haveStamp: true, problems: ['residents: the roll named "wright" and the card door answered 404 — the row is HELD OVER'] });
  assert.equal(p.verdict, "STALE", "a finding, not an outage — the site is fresh and something in it is not");
  assert.ok(BAD.has(p.verdict), "and STALE is in BAD, so it actually alarms rather than only colouring a board");
  // NAMED, NOT COUNTED: the reason must carry the entity and the door, because
  // "1 problem" tells a reader nothing they can act on.
  assert.match(p.reason, /the roll named "wright"/);
  assert.match(p.reason, /404/);
  return tick({ fetchImpl: stubFetch(table), exec: stubExec(), state: {}, nowMs: T0, config: FIXTURE_CONFIG })
    .then(({ probes, alerts }) => {
      const probe = probes.find((x) => x.key === "site_build_problems");
      assert.ok(probe, "the probe must exist in a real tick, not only as a pure function");
      assert.equal(probe.verdict, "STALE");
      assert.ok(alerts.some((a) => a.key === "site_build_problems"), "and it must reach the alert channel");
    });
});

test("the SAME build.json with an empty problems list does NOT red", () => {
  const table = {
    ...GREEN_TABLE,
    "https://postmark.town/build.json": {
      status: 200,
      body: JSON.stringify({ channel: "release", code_sha: "relsha00000", town_data_sha: "sitetip0000", crossing: 149, problems: [] }),
    },
  };
  assert.equal(classifyProblems({ haveStamp: true, problems: [] }).verdict, "OK");
  return tick({ fetchImpl: stubFetch(table), exec: stubExec(), state: {}, nowMs: T0, config: FIXTURE_CONFIG })
    .then(({ probes, alerts }) => {
      const probe = probes.find((x) => x.key === "site_build_problems");
      assert.equal(probe.verdict, "OK", "a build that got everything it asked for is green, not merely un-alarmed");
      assert.deepEqual(alerts.filter((a) => a.key === "site_build_problems"), []);
    });
});

test("THE DEPLOY-ORDER TRAP: a build.json with NO problems key at all must NOT red", () => {
  // The two repos deploy independently. Between this probe shipping in the
  // office and the `problems` field shipping in postmark-site, EVERY build.json
  // prod serves is keyless — and prod keeps serving the last release for as
  // long as it takes the site's train to land. A probe that alarmed there would
  // page the founder for the whole rollout, about a site that is working
  // correctly, which is precisely the alarm a reader learns to mute.
  //
  // INFO is this file's existing word for a probe that is counted, never
  // alarmed and never silent. UNKNOWN would have been the other candidate and
  // is deliberately NOT used: it would paint the whole board DEGRADED for the
  // duration of an ordinary rollout.
  const keyless = { channel: "release", code_sha: "relsha00000", town_data_sha: "sitetip0000", crossing: 149 };
  assert.equal("problems" in keyless, false, "the fixture must actually be keyless or this proves nothing");
  const p = classifyProblems({ haveStamp: true, problems: keyless.problems });
  assert.equal(p.verdict, "INFO");
  assert.equal(BAD.has(p.verdict), false, "an older stamper is not a fault");
  assert.match(p.reason, /predates/, "and it says WHY, so a reader knows the field is new rather than the site being clean");

  const table = { ...GREEN_TABLE, "https://postmark.town/build.json": { status: 200, body: JSON.stringify(keyless) } };
  return tick({ fetchImpl: stubFetch(table), exec: stubExec(), state: {}, nowMs: T0, config: FIXTURE_CONFIG })
    .then(({ probes, alerts }) => {
      const probe = probes.find((x) => x.key === "site_build_problems");
      assert.equal(probe.verdict, "INFO");
      assert.deepEqual(alerts, [], "a keyless build.json must produce NO alert of any kind");
    });
});

test("`problems: null` is UNREAD, not clean — UNKNOWN, and it never reads as green", () => {
  // The site's stamper writes null when it could not read its own town
  // manifest. Treating that as [] would be a false all-clear arriving exactly
  // when the build had stopped being able to look.
  const p = classifyProblems({ haveStamp: true, problems: null });
  assert.equal(p.verdict, "UNKNOWN");
  assert.equal(BAD.has(p.verdict), false, "unreadable is not itself an alarm");
  assert.notEqual(p.verdict, "OK", "…but it must never be mistaken for a clean build");
  assert.match(p.reason, /unread is never clean/);
  // A shape that is neither list nor null is the same answer, not a crash.
  assert.equal(classifyProblems({ haveStamp: true, problems: "one problem" }).verdict, "UNKNOWN");
  assert.equal(classifyProblems({ haveStamp: true, problems: 3 }).verdict, "UNKNOWN");
});

test("no /build.json at all speaks in its own words rather than vanishing", () => {
  const p = classifyProblems({ haveStamp: false });
  assert.equal(p.verdict, "UNKNOWN");
  assert.match(p.reason, /serves no \/build\.json/);
});

test("the bark names EVERY problem it can and says how many it held back", () => {
  // A held-back remainder that is not counted is a silent truncation, and the
  // reader would act on three when there were nine.
  const nine = Array.from({ length: 9 }, (_, i) => `residents: handle-${i} answered 404`);
  const p = classifyProblems({ haveStamp: true, problems: nine });
  assert.equal(p.verdict, "STALE");
  assert.match(p.reason, /published with 9 problems/);
  assert.match(p.reason, /and 6 more/, "the remainder is counted, never dropped");
  // and the singular reads as English
  assert.match(classifyProblems({ haveStamp: true, problems: ["one thing"] }).reason, /published with 1 problem its build/);
});
