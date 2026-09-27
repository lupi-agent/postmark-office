// site-sentinel — the loud eye on whether the town is UP and whether it is FRESH.
//
// Built 2026-08-25, the day the site's half-hourly "Sync Postmark atlas" ran red
// on every tick for a full day while its sibling "Deploy" stayed green beside it,
// and nobody was told. The founder's sentence is the whole specification:
//
//     "how can we LOUDLY BE NOTIFIED when something is down on the site?"
//
// The answer this file gives is a posture, not a feature: WATCH THE OUTCOMES,
// NOT THE PIPELINES. A pipeline probe can only catch the failures someone
// already imagined and wired a check for. An outcome probe — is the page
// answering, is the served bytes the current bytes — catches causes nobody
// predicted, including the ones that have not been invented yet. The workflow
// probe is here too (§5), but deliberately last and deliberately framed as a
// SECOND opinion: a red pipeline beside a green outcome is a finding, and a
// green pipeline beside a red outcome is a lie.
//
// Posture, borrowed verbatim from harbor-watch.mjs because it is the same
// posture: "This script only reads and reports — it never writes to any world."
// It touches no clone, holds no pen, takes no lock. Its only writes are its own
// state file, its own status board, and an HTTP POST to a Discord webhook.
//
// ── WHAT IT WILL NOT DO, AND WHY ────────────────────────────────────────────
//
// It does not restart anything, redeploy anything, or re-run a workflow. A
// watcher that acts on its own reading is a watcher whose reading nobody checks;
// the 2026-08-19 stranded-crossings incident is the town's own receipt for what
// an unwatched automatic hand costs. Detection is mechanical here; the repair
// stays a hand.
//
// It also cannot see its own death. If the box is down, or the timer is masked,
// this file does not run and therefore does not alarm — the classic watchman
// problem, and it is NOT solved here. Solving it needs an off-box heartbeat
// (a dead-man's switch someone else pings), which is a second machine and
// outside this lane. Named rather than papered over, because a sentinel that
// implies coverage it does not have is worse than no sentinel.
//
// ── THE THREE THINGS THAT MADE THE DESIGN, ALL MEASURED, NOT ASSUMED ────────
//
// 1. GitHub's UNAUTHENTICATED REST budget is 60/hour per IP, and a conditional
//    request that returns 304 STILL SPENDS ONE. Measured 2026-08-25 against the
//    live API: X-RateLimit-Used went 4 -> 5 across a request that answered
//    "304 Not Modified". So ETags buy bandwidth, not budget. This watch
//    therefore spends at most TWO REST calls per tick (12/hour at the 10-minute
//    cadence, a fifth of the budget, leaving room for whatever else on the box
//    shares the address): one combined /actions/runs read for every workflow at
//    once, and one commits?path= read for the daily's source. Every commit SHA
//    it needs comes from `git ls-remote`, which is the git wire protocol and
//    spends no REST budget at all.
//
// 2. PROD DOES NOT BUILD FROM MAIN, so "deployed sha vs main tip" is not a
//    staleness test — it is a permanent false alarm. deploy.yml's release lane
//    checks out the newest `release/*` tag and builds the CODE from there, then
//    overlays the town DATA from main (`git checkout origin/main -- ...`).
//    Prod lagging main on code is the design. Which is why the stamp this
//    watch reads carries TWO shas and the watch compares each against its own
//    reference: code against the release tag, town data against main.
//
// 3. THE 08-24 FREEZE IS THE PROOF THAT THE SECOND HALF MATTERS. deploy.yml's
//    own comment records it: "prod served Crossing 144 while main carried 146"
//    — the code was correctly pinned and the content was silently frozen behind
//    it. A one-sha stamp cannot express that failure. A two-sha stamp makes it
//    the first thing you see.
//
// ── THE PROBES ──────────────────────────────────────────────────────────────
//
//  1. UP        — the public doors answer 200. Cheapest API door is GET /api/,
//                 the capability manifest: static, public, no DB work, and it
//                 carries X-Postmark-As-Of, so probe 3 rides along on it for
//                 free. dev.postmark.town is INFO-only: it sits behind
//                 Cloudflare Access and a 302 to *.cloudflareaccess.com is its
//                 HEALTHY shape, so alarming on it would train the reader to
//                 ignore the channel.
//  2. FRESH/SITE — /build.json's code_sha vs the newest release/* tag, and its
//                 town_data_sha vs site main's tip. Time-anchored (below).
// 2b. FRESH/CROSSING — /build.json's `crossing` vs the office's own crossing
//                 number at GET /api/. THE EVENT-SHAPED QUESTION, added
//                 2026-08-26 with the box refresh timer: mail moves at
//                 crossings, not on a wall clock, so "has a ferry landed since
//                 this page was built" is a question no duration threshold can
//                 answer. Costs zero extra requests — it reads the body of the
//                 manifest probe 1 already opens. Probe 2 stays as the floor.
//  3. FRESH/DATA — the served X-Postmark-As-Of vs the town repo's main tip.
//                 This is the probe that would have caught the stuck rehydrate
//                 tick found BY HAND on 2026-08-25 (one distinct as-of across
//                 40 minutes and three scheduled tick slots).
//  4. FRESH/DAILY— the served /daily/ferrys-daily.html actually contains the
//                 current TOWN_BULLETIN/ferrys-daily.md's headline. Note the
//                 path: /daily/ is a WRAPPER page that links to the daily and
//                 does not inline its prose, so probing /daily/ for the daily's
//                 text answers a question nobody asked.
//  5. WORKFLOWS  — the latest run per workflow on main that actually DECIDED
//                 something. Cancellations are looked through, never counted as
//                 health: these two workflows cancel each other by concurrency
//                 group all day, and the first version of this probe called that
//                 green and reported the 08-25 fire itself as fine.
//
// ── THE STALENESS CLOCK, AND WHY IT IS ANCHORED WHERE IT IS ─────────────────
//
// Every freshness probe compares a SERVED value against a REFERENCE value, and
// the naive rule ("alarm when they differ") is wrong twice over: it fires during
// the ordinary minutes between a push and its deploy, and — subtler — anchoring
// the clock to the PAIR means a repo that commits every 30 minutes resets the
// clock every 30 minutes and can never accumulate an alarm even while every
// deploy fails.
//
// So the clock is anchored to the DIVERGENCE: how long has the reference been
// somewhere the served value is not? It starts the moment the two first differ,
// PERSISTS while the reference keeps moving (a busy repo cannot hide a frozen
// site — the original anchoring law, kept), and clears the moment they agree
// or the served value advances (a progressing pipeline is never stale).
//
// HISTORY, because the previous anchor rang 6-7 false alarms a day and its
// header note claimed it couldn't (found 2026-08-31, Keemin's challenge): the
// clock used to be anchored to the SERVED value alone — "how long has the site
// answered with THIS value" — on the argument that a quiet repo never alarms
// since served equals reference. True while quiet; false at the first commit
// AFTER the quiet: the town sat unchanged for 59 minutes (01:32-02:31Z, an
// ordinary quiet hour), one stake landed, and nine minutes later the sentinel
// declared 49 minutes of staleness — the age of a perfectly current serve of a
// perfectly quiet repo. Serving an old sha of a repo that hasn't moved is
// health; only trailing a KNOWN-NEWER reference is staleness, and the clock
// now measures exactly that.
//
// Usage:
//   node tools/site-sentinel.mjs [--state <state.json>] [--out <status.json>]
//                                [--json] [--dry-run] [--now <iso>]

import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
// The town clock, imported rather than restated. crossings.mjs was split out of
// world.mjs for exactly this: a small tool that needs "how many crossings old is
// this?" gets the arithmetic without a second copy of it, and there stays
// exactly one place the ruling lives.
import { CROSSING_EPOCH_UTC, CROSSING_MS } from "../src/crossings.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// ── configuration ───────────────────────────────────────────────────────────

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

export const CONFIG = {
  // Every door a reader actually opens. The API entry is GET /api/ and not
  // /api/residents/<handle>: the manifest is a constant in memory while a
  // resident read walks the index, and both carry the same as-of header, so the
  // cheap one is strictly better as a liveness probe.
  doors: [
    { key: "site_home", url: "https://postmark.town/", label: "postmark.town" },
    { key: "site_daily", url: "https://postmark.town/daily/", label: "the Daily page" },
    { key: "site_world", url: "https://postmark.town/world/", label: "the World page" },
    { key: "site_bulletin", url: "https://postmark.town/bulletin/", label: "the bulletin" },
    { key: "office_api", url: "https://postmark.town/api/", label: "the office API" },
  ],
  // INFO-ONLY BY CONSTRUCTION. dev sits behind Cloudflare Access; its healthy
  // answer is a 302 to an Access login. It is reported so a reader can see it,
  // and it can never raise an alert — see classifyUp's accessGate branch.
  devDoor: { key: "dev_site", url: "https://dev.postmark.town/", label: "dev.postmark.town" },

  buildStamp: "https://postmark.town/build.json",
  dailyServed: "https://postmark.town/daily/ferrys-daily.html",
  dailySource: "https://raw.githubusercontent.com/postmark-town/postmark/main/TOWN_BULLETIN/ferrys-daily.md",

  siteRepo: { owner: "keeminlee", name: "postmark-site" },
  townRepo: { owner: "postmark-town", name: "postmark" },
  dailyPath: "TOWN_BULLETIN/ferrys-daily.md",

  // Thresholds. Each is the cadence of the thing being watched plus enough
  // slack that an ordinary slow run is not an alarm.
  //   site code : the release train is roughly weekly, but a cut tag should
  //               reach prod within an hour of being cut.
  //   town data : sync-atlas runs every ~30 min and Deploy follows it.
  //   office    : the rehydrate timer fires at *:07,22,37,52 — every 15 min.
  //               30m under the divergence anchor is TWO DEAD TICKS behind a
  //               known-newer tip (Keemin-tightened 2026-08-31, the same
  //               night the anchor was fixed). History of the number: 45m
  //               under the old served-value anchor rang 6-7 false alarms a
  //               day — every quiet stretch plus one push — and was briefly
  //               widened to 60m before the real bug was found in the
  //               measurement, not the window. With the clock honest, tight
  //               is cheap: a real wedge pages in half an hour and a quiet
  //               hour pages nobody.
  //   daily     : sync + deploy, end to end.
  staleAfter: {
    site_code: 3 * HOUR,
    site_town_data: 3 * HOUR,
    office_as_of: 30 * MINUTE,
  },
  dailySlack: 90 * MINUTE,

  // §2b — how long a crossing may stand un-rebaked before it is a finding.
  //
  // Sixty minutes is not a round number, it is TWO CHANCES. The box timer fires
  // at :10 and :40 past the hour (postmark-site-refresh.timer); a crossing lands
  // on the hour, so the :10 tick is the first attempt and the :40 tick is the
  // recovery. An hour after a crossing, BOTH have had their turn and a site
  // still showing the previous crossing is not a slow build — it is a broken
  // one. Set it shorter and every ordinary build reports itself; set it longer
  // and the 2026-08-26 incident (97 minutes behind a ferry) stays quiet for
  // most of its life.
  crossingGrace: 60 * MINUTE,

  // §6 — the box's own watchers. The sentinel runs beside them, so their
  // state files are local facts. A watcher whose state is ABSENT while its
  // timer stands enabled is DOWN, never UNKNOWN: on 2026-08-26 usdc-watch
  // crash-looped on EACCES for 22 hours behind an all-green board, because
  // nothing asked whether the watchers themselves were alive.
  watchers: [
    // `unit` names the timer each cadence is copied FROM. It is not decoration:
    // the two numbers live in different files, and test/site-sentinel.test.mjs
    // reads the unit and refuses a cadence that does not match it. stripe_watch
    // said 10 minutes here while its timer has always fired every 15 (caught
    // 2026-08-27) — with a 3× tolerance that put a healthy rail one missed tick
    // from STALE, under a reason line quoting a cadence the box does not run.
    { key: "usdc_watch", label: "the usdc-watch timer", state: "/srv/postmark-usdc/state.json",
      unit: "postmark-usdc-watch.timer", cadenceMs: 10 * MINUTE },
    { key: "stripe_watch", label: "the stripe-watch timer", state: "/srv/postmark-stripe/state.json",
      unit: "postmark-stripe-watch.timer", cadenceMs: 15 * MINUTE,
      adoptedWhen: "/srv/postmark-stripe" }, // Stage B: parked until adopted — absence of the DIR is INFO, not DOWN
  ],

  // §7 — the box's own publisher, and why it is NOT a `watchers` row.
  //
  // A watcher is classified on its heartbeat alone: the state file's mtime
  // against a cadence. That is the right question for a rail whose only job is
  // to tick. It is the WRONG question here, and 2026-09-17 is the receipt: the
  // 08:10Z refresh wrote its report on time, from a run that had published a
  // 134-resident town, and a heartbeat probe would have called that fresh and
  // green. The refresh's report carries an OUTCOME, so the outcome is what gets
  // read. (deploy/box-rollcall-manifest.json already watches this same file's
  // heartbeat — `stamp_field: at`, 100 minutes — and that row stays: the pair
  // survives either half being the thing that broke, the same reason the
  // usdc_watch duplicate is deliberate.)
  //
  // `unit` is not decoration, exactly as in `watchers`: the cadence and the
  // timer live in different files, and test/site-sentinel.test.mjs reads the
  // unit and refuses a cadence that does not match it.
  siteRefresh: {
    key: "site_refresh",
    label: "the box's site refresh",
    report: "/srv/postmark-harbor/site-refresh.json",
    unit: "postmark-site-refresh.timer",
    cadenceMs: 30 * MINUTE,
  },

  requestTimeoutMs: 20_000,
  // One reminder every twelve hours while a probe stays bad. Not per tick —
  // a channel that pings every ten minutes is a channel the reader mutes, and a
  // muted channel is exactly the silent failure this file exists to end.
  reminderMs: 12 * HOUR,
  userAgent: "postmark-site-sentinel",
};

// ── §1 up: classification ───────────────────────────────────────────────────

/**
 * One door's verdict.
 *
 * `error` is set when the request never produced a response at all (DNS,
 * refused, TLS, timeout). That is the loudest case and it is DOWN without
 * qualification — a door that does not answer is down however sympathetic the
 * reason.
 *
 * A 4xx is DOWN too, deliberately. These are five paths that are supposed to
 * exist; a 404 on /daily/ means the deploy shipped a tree without it, which is
 * an outage wearing a tidy status code.
 */
export function classifyUp({ status = null, location = null, error = null, infoOnly = false } = {}) {
  if (error) {
    return infoOnly
      ? { verdict: "INFO", reason: `did not answer (${String(error).slice(0, 120)}) — info-only door, not alarmed` }
      : { verdict: "DOWN", reason: `did not answer at all: ${String(error).slice(0, 120)}` };
  }
  // The Access gate. A 302 whose Location is a cloudflareaccess.com login is
  // dev's HEALTHY shape, not a redirect loop — recognised by the destination
  // host rather than by the status code, because a 302 anywhere else is a
  // finding and must not be swallowed by the same branch.
  const accessGate = status === 302 && /(^|\.)cloudflareaccess\.com\//.test(String(location ?? ""));
  if (accessGate) return { verdict: "INFO", reason: "302 to the Cloudflare Access login — its healthy shape, gated as designed" };
  if (infoOnly) {
    return status >= 200 && status < 400
      ? { verdict: "INFO", reason: `HTTP ${status}` }
      : { verdict: "INFO", reason: `HTTP ${status} — info-only door, not alarmed` };
  }
  if (status >= 200 && status < 300) return { verdict: "OK", reason: `HTTP ${status}` };
  if (status >= 300 && status < 400) return { verdict: "DOWN", reason: `HTTP ${status} to ${String(location ?? "an unnamed location")} — this path should serve, not redirect` };
  if (status >= 500) return { verdict: "DOWN", reason: `HTTP ${status} — the server broke on a path that should serve` };
  return { verdict: "DOWN", reason: `HTTP ${status} — a page that is supposed to exist did not` };
}

// ── §2/§3 freshness: the time-anchored comparison ───────────────────────────

/**
 * Compare a SERVED value against a REFERENCE, with the clock anchored to the
 * DIVERGENCE (see the header's staleness-clock note, and its history — the
 * served-value anchor this replaces alarmed on every quiet-hour-then-one-push).
 *
 * `seen` is the caller's memory: { value, first_seen_at, diverged_since }.
 * `diverged_since` is when the reference was first observed somewhere the
 * served value is not; null while they agree. It persists while the reference
 * keeps moving (a busy repo cannot hide a frozen site) and clears when the
 * served value advances (a progressing pipeline is never stale). Returned
 * updated, so a falsifier can run the whole comparison and prove the memory
 * advanced (or did not) without owning a filesystem.
 *
 * A divergence the watch has never seen before starts its clock NOW and cannot
 * be stale on that tick — the same cold-start honesty as before: the watch
 * genuinely does not know how long the reference has been ahead, and guessing
 * would be inventing evidence. (A pre-upgrade state file, which carries no
 * diverged_since, gets the same one-tick grace for the same reason.)
 */
export function classifyStamp({ served, reference, seen = null, nowMs, staleAfterMs, what, referenceName }) {
  if (served == null) {
    return { verdict: "UNKNOWN", reason: `could not read ${what} from the live site`, seen: seen ?? null };
  }
  if (reference == null) {
    return { verdict: "UNKNOWN", reason: `could not read ${referenceName} to compare ${what} against`, seen: seen ?? null };
  }
  const sameValue = seen && seen.value === served;
  const firstSeenAt = sameValue ? seen.first_seen_at : nowMs;
  const shortS = String(served).slice(0, 10);
  const shortR = String(reference).slice(0, 10);

  if (served === reference) {
    return { verdict: "OK", reason: `${what} matches ${referenceName} (${shortS})`,
      seen: { value: served, first_seen_at: firstSeenAt, diverged_since: null } };
  }

  // Diverged. The clock starts at the first observed divergence and survives
  // further reference movement; a changed served value restarts it (progress).
  const divergedSince = (sameValue ? seen.diverged_since : null) ?? nowMs;
  const nextSeen = { value: served, first_seen_at: firstSeenAt, diverged_since: divergedSince };
  const behindFor = nowMs - divergedSince;
  if (behindFor < staleAfterMs) {
    return {
      verdict: "OK",
      reason: `${what} is ${shortS} and ${referenceName} moved ahead to ${shortR} ${humanDuration(behindFor)} ago — inside the ${humanDuration(staleAfterMs)} deploy window`,
      seen: nextSeen,
    };
  }
  return {
    verdict: "STALE",
    reason: `${what} has trailed ${referenceName} for ${humanDuration(behindFor)} (serving ${shortS}, source at ${shortR}) — the source moved on and the site has not followed`,
    seen: nextSeen,
  };
}

// ── §2b the crossing: the event-shaped freshness question ───────────────────

/**
 * Is the site showing the CURRENT ferry crossing?
 *
 * WHY A WALL-CLOCK THRESHOLD IS NOT ENOUGH, which is this probe's whole reason
 * to exist. Every other freshness probe here asks "how long has the served value
 * been frozen?" — a duration question. But mail does not move on a duration; it
 * moves at crossings, 00:00 and 12:00 UTC, and everything a resident cares about
 * changes in that one instant. A three-hour threshold measured from whenever the
 * site last happened to change cannot see that: on 2026-08-26 the site had
 * rebuilt recently enough to look healthy by the clock while the ferry that had
 * landed 97 minutes earlier was nowhere on it, and 48 doorstep pages served
 * yesterday's mail. The freshness architecture names the repair directly:
 * "a wall-clock threshold cannot see an event-shaped failure."
 *
 * So this asks the event question instead: the site's build stamp carries the
 * crossing it was baked at, the office serves the crossing it is now, and the
 * gap between them is either zero or a finding. The wall-clock probes stay
 * exactly as they were — they are the floor under this, and they catch the
 * failures that have nothing to do with crossings.
 *
 * NO MEMORY. Every other freshness probe needs a `seen` record because it cannot
 * know when its reference moved. This one can: a crossing is a pure function of
 * time (src/crossings.mjs — 12h since 2026-06-12), so "how long has crossing N
 * been the current one?" is arithmetic, not history. That is worth saying out
 * loud, because a probe with no state cannot be wrong about its own past.
 *
 * @param {number|null} servedCrossing  from the site's /build.json
 * @param {number|null} officeCrossing  from GET /api/'s crossing.number
 */
export function classifyCrossing({ servedCrossing, officeCrossing, nowMs, graceMs, haveStamp = true, epochMs = CROSSING_EPOCH_UTC, crossingMs = CROSSING_MS }) {
  // The two ways the site's half can be unreadable are different repairs, so
  // they are different sentences. "No stamp at all" is a deploy that did not
  // emit one; "a stamp with no crossing" is an old stamper or a build that
  // could not reach the office. A reader at 3am should not have to open the
  // other probes to learn which.
  if (!haveStamp)
    return { verdict: "UNKNOWN", reason: "the deployed site serves no /build.json at all, so there is no baked crossing to compare" };
  if (!Number.isInteger(servedCrossing))
    return { verdict: "UNKNOWN", reason: "the site's build stamp names no crossing — an older build stamper, or a build that could not reach the office to ask" };
  if (!Number.isInteger(officeCrossing))
    return { verdict: "UNKNOWN", reason: "the office did not serve a crossing number to compare against (GET /api/ crossing.number)" };

  const gap = officeCrossing - servedCrossing;
  // Ahead is not a failure. A build that started before a crossing and finished
  // after it stamps the newer number, which is honest — the town data it baked
  // was read on the far side of the ferry.
  if (gap <= 0) return { verdict: "OK", reason: `the site is baked at crossing ${servedCrossing} and the town is at ${officeCrossing}` };

  // How long has the town been at this crossing? Not "how long has the site been
  // frozen" — the question is how much of the current crossing the site has
  // already missed.
  const landedMs = nowMs - (epochMs + officeCrossing * crossingMs);

  if (gap === 1 && landedMs < graceMs) {
    return {
      verdict: "OK",
      reason: `crossing ${officeCrossing} landed ${humanDuration(landedMs)} ago and the site is still baked at ${servedCrossing} — inside the ${humanDuration(graceMs)} rebuild window`,
    };
  }
  // Two or more behind is stale whatever the clock says: a whole crossing came
  // and went without the site noticing, so no rebuild window can excuse it.
  const behind = gap === 1 ? "a ferry has landed" : `${gap} ferries have landed`;
  return {
    verdict: "STALE",
    reason: `${behind} since the site was built — the site is baked at crossing ${servedCrossing}, the town is at ${officeCrossing}, and crossing ${officeCrossing} landed ${humanDuration(landedMs)} ago`,
  };
}

// ── §2c THE BUILD THAT PUBLISHED WITH PROBLEMS (POS-180, 2026-09-21) ────────
//
// Every other freshness probe here asks "is the site CURRENT?". This one asks
// a question none of them can: the site is current, and something inside it is
// not. On 2026-09-21 the town shed a bulletin entry, the entry door 404'd, and
// the site build refused to publish at all — every page on postmark.town froze
// for thirty minutes over one deleted entry. POS-166 and POS-180 make that a
// DROP instead of an outage: the build publishes, the shed thing leaves, a
// 404'd resident keeps the row they had, and the build writes down what it
// could not get.
//
// The founder's ruling is the whole design of this probe: "We just need to know
// this happened, not block things on it." A drop that nothing can see is not a
// fix, it is a silence — and until this probe existed, `problems` was assembled
// by the site's fetch and written only to a build log nobody reads on a
// schedule. This is the half that makes the drop safe.
//
// WHY STALE AND NOT DOWN. The site is up, fresh, and serving. What is wrong is
// that one row in it is held over from an earlier build, or one entry the town
// still names is missing. DOWN would say the site is unreachable, which is
// false, and a probe that cries outage over a shed handle is the alarm a reader
// learns to ignore. STALE is already this file's word for "what is served is
// behind what it should be", it is already in BAD so it alarms and reminds, and
// it is the true sentence here. No new severity is invented for it.
//
// FOUR STATES, AND THE DEPLOY-ORDER TRAP IS THE THIRD ONE.
//   a list with rows  the build published and could not get these things.
//   an empty list     the build asked for everything and got it.
//   `problems: null`  a POS-180 stamper that could not read its own manifest.
//                     Unread, never clean — UNKNOWN, the same way every other
//                     null on that stamp is read.
//   NO KEY AT ALL     an older stamper. This is not a fault and MUST NOT red:
//                     the two repos deploy independently, so between the office
//                     shipping this probe and the site shipping the field,
//                     every build.json prod serves is keyless. A probe that
//                     alarmed there would page the founder for the duration of
//                     an ordinary rollout, about a site that is working. INFO
//                     is this file's existing word for a probe that is counted,
//                     never alarmed and never silent, and it is exactly right
//                     while the field is not adopted yet.
export function classifyProblems({ haveStamp = false, problems = undefined } = {}) {
  if (!haveStamp) {
    return { verdict: "UNKNOWN", reason: "the deployed site serves no /build.json at all, so it cannot say what its build could not get" };
  }
  if (problems === undefined) {
    return { verdict: "INFO", reason: "this build's stamp predates the `problems` field (postmark-site tools/build-stamp.mjs, POS-180) — an older build is still being served, which is an ordinary rollout and not a fault" };
  }
  if (problems === null) {
    return { verdict: "UNKNOWN", reason: "the build stamp carries `problems: null` — the build could not read its own town manifest, so it cannot say what it failed to get; unread is never clean" };
  }
  if (!Array.isArray(problems)) {
    return { verdict: "UNKNOWN", reason: `the build stamp's \`problems\` is a ${typeof problems}, not a list — the stamp cannot be read on this point` };
  }
  if (problems.length === 0) {
    return { verdict: "OK", reason: "the build that published this site got everything it asked the office for" };
  }
  // NAMED, NOT COUNTED. A reader who is paged at 3am needs the entity and the
  // door, because the action differs completely: a shed handle is nothing to do,
  // a resident whose card has been 404ing for a week is an office bug. The
  // count leads so the shape of the failure is readable at a glance, and the
  // lines follow so it is actionable without a second lookup.
  const shown = problems.slice(0, 3).map((p) => String(p).slice(0, 200));
  const more = problems.length - shown.length;
  return {
    verdict: "STALE",
    reason: `the site published with ${problems.length} problem${problems.length > 1 ? "s" : ""} its build could not get: ${shown.join(" · ")}${more > 0 ? ` · and ${more} more` : ""}`,
  };
}

/** "1h12m" / "45m" / "3d 2h" — short enough to read inside a sentence. */
export function humanDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "an unknown time";
  const m = Math.floor(ms / MINUTE);
  if (m < 1) return "under a minute";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), rm = m % 60;
  if (h < 24) return rm ? `${h}h${rm}m` : `${h}h`;
  const d = Math.floor(h / 24), rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}

// ── §4 the daily: an outcome fingerprint, not a timestamp ───────────────────

/**
 * Squash text to lowercase alphanumerics and single spaces.
 *
 * Load-bearing, not tidiness: the source is markdown and the served page is
 * HTML through a renderer, so the SAME sentence differs by smart quotes, by
 * &amp; and &#39;, by em-dash normalisation and by tag boundaries. Comparing
 * raw bytes would report a stale daily every single day. Comparing squashed
 * text compares what a reader would say is the same sentence.
 *
 * TAGS AND ENTITIES COME OUT FIRST, AND THAT ORDER IS THE WHOLE CORRECTNESS.
 * Squashing straight to alphanumerics leaves the DIGITS of a numeric entity
 * behind — `&#8220;An` becomes ` 8220 an `, which silently fails to contain
 * `an`, so a perfectly current daily reads as stale. Its falsifier caught this
 * on the first run.
 */
export const normalizeText = (s) =>
  String(s ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x[0-9a-f]+;|&#\d+;|&[a-z]+;/gi, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * The daily's fingerprint: its lead headline.
 *
 * Ferry's Daily is rewritten every round and its lead `## "…"` heading changes
 * with it, so the headline is the field that moves whenever the daily moves.
 * The crossing line is the fallback because it always exists but only advances
 * twice a day — good as a backstop, blind to a mid-crossing re-tending, which
 * is why it is second and not first.
 */
export function dailyFingerprint(markdown) {
  const text = String(markdown ?? "");
  const heading = text.match(/^##\s+(?!#)(.+)$/m)?.[1];
  if (heading && normalizeText(heading).length >= 12) return { kind: "headline", value: heading.trim() };
  const crossing = text.match(/Crossing\s+\d+/)?.[0];
  if (crossing) return { kind: "crossing", value: crossing };
  return { kind: "none", value: null };
}

/**
 * Is the deployed daily the current daily?
 *
 * The pipeline gets its window: if the source changed five minutes ago, its
 * absence downstream is a deploy in flight, not a failure. Past the window,
 * absence is the outcome failing and the reason quotes the sentence that is
 * missing, so the reader can paste it into the page and see for themselves.
 */
export function classifyDaily({ fingerprint, servedHtml, sourceCommittedAtMs = null, nowMs, slackMs }) {
  if (servedHtml == null) return { verdict: "UNKNOWN", reason: "could not read the served daily page" };
  if (!fingerprint || fingerprint.kind === "none")
    return { verdict: "UNKNOWN", reason: "could not find a headline or crossing line in the town's ferrys-daily.md to fingerprint" };

  const present = normalizeText(servedHtml).includes(normalizeText(fingerprint.value));
  if (present) return { verdict: "OK", reason: `the served daily carries the town's current ${fingerprint.kind} (${String(fingerprint.value).slice(0, 60)})` };

  const age = sourceCommittedAtMs == null ? null : nowMs - sourceCommittedAtMs;
  if (age != null && age < slackMs)
    return { verdict: "OK", reason: `the town's daily changed ${humanDuration(age)} ago and has not reached the site yet — inside the ${humanDuration(slackMs)} sync-and-deploy window` };

  const since = age == null ? "an unknown time" : humanDuration(age);
  return {
    verdict: "STALE",
    reason: `the served daily does not carry the town's current ${fingerprint.kind} — "${String(fingerprint.value).slice(0, 70)}" — committed ${since} ago; the town has a newer Daily than the site is showing`,
  };
}

// ── §5 the workflows: the second opinion ────────────────────────────────────

// Conclusions that carry no verdict about the workflow's health. `cancelled`
// and `skipped` say only that this particular run stopped; they are the
// concurrency group's fingerprints, not the workflow's condition.
export const INDECISIVE = new Set([null, undefined, "cancelled", "skipped"]);

/**
 * The newest run per workflow that actually DECIDED something.
 *
 * ⚑ THIS FUNCTION'S FIRST VERSION MADE THE EXACT MISTAKE THE FILE EXISTS TO
 * PREVENT, and only running it against the live town found it. It took the
 * newest COMPLETED run and treated `cancelled` as healthy — reasonable-sounding,
 * because these two workflows cancel each other through their concurrency
 * groups all day. But on 2026-08-25, with "Sync Postmark atlas" failing on every
 * run for hours, the newest completed run of BOTH workflows happened to be a
 * cancellation, so the board came back green and the sentinel said nothing about
 * the fire it was built for. A probe that cannot fail on the thing it names is
 * not a probe.
 *
 * The repair is to make cancellations TRANSPARENT rather than green: look
 * through them to the last run that reached a real verdict. In-progress runs
 * (conclusion `null`) are looked through for the same reason — letting a null
 * overwrite yesterday's `failure` would make a permanently broken workflow look
 * clean for the minutes it spends running.
 *
 * A workflow whose whole recent history is cancellations therefore reports
 * UNKNOWN, not OK: no run decided anything, and "nobody has checked" must never
 * render as "checked and fine".
 */
export function latestDecisiveRunPerWorkflow(runs) {
  const out = new Map();
  for (const r of runs ?? []) {
    if (r?.status !== "completed" || INDECISIVE.has(r?.conclusion)) continue;
    if (!out.has(r.name)) out.set(r.name, r);
  }
  return out;
}

/**
 * A red latest-conclusion is a finding EVEN WHEN THE OUTCOMES LOOK GREEN — that
 * is this probe's entire reason to exist. On 2026-08-25 the site's outcomes were
 * all healthy while "Sync Postmark atlas" had failed every run for hours; the
 * outcome probes above would (correctly) have said nothing, and the town would
 * have gone on not knowing until the freeze surfaced.
 *
 * Reads the last DECISIVE run (see above) — cancellations are looked through,
 * never counted as health.
 */
// §6 — a watcher's own pulse, from its state file's mtime. Pure so the
// falsifiers can drive every branch. The law, from the night that earned it:
// "a rail that has not ticked is not a quiet rail" — and a watcher with no
// state at all is the loudest kind of not-ticking there is.
export function classifyWatcher({ adopted = true, exists, mtimeMs = null, nowMs, cadenceMs, label }) {
  if (!adopted) return { verdict: "INFO", reason: `${label} is not adopted (Stage B parked) — nothing to watch yet` };
  if (!exists) return { verdict: "DOWN", reason: `${label} has no state file — it has never run or cannot write (an enabled timer with no state is a crashloop, not a quiet rail)` };
  const age = nowMs - mtimeMs;
  if (age > 3 * cadenceMs) return { verdict: "STALE", reason: `${label} last wrote its state ${Math.round(age / 60000)} min ago against a ${Math.round(cadenceMs / 60000)}-min cadence` };
  return { verdict: "OK", reason: `ticked ${Math.round(age / 60000)} min ago` };
}

export function classifyWorkflows(latest, { watch = ["Sync Postmark atlas", "Deploy"] } = {}) {
  const rows = [];
  for (const wanted of watch) {
    const key = `workflow_${slug(wanted)}`;
    const hit = [...latest.entries()].find(([name]) => name.toLowerCase().startsWith(wanted.toLowerCase()));
    if (!hit) {
      rows.push({ key, workflow: wanted, verdict: "UNKNOWN", reason: `no run of "${wanted}" on main reached a verdict in the window read — every recent run was cancelled or is still going, so nothing has been decided` });
      continue;
    }
    const [name, run] = hit;
    if (run.conclusion === "success" || run.conclusion === "neutral") {
      rows.push({ key, workflow: name, verdict: "OK", reason: `last decisive run on main succeeded (${run.created_at})` });
      continue;
    }
    rows.push({
      key,
      workflow: name,
      verdict: "DOWN",
      reason: `last decisive run on main was "${run.conclusion}" at ${run.created_at} — ${run.html_url ?? "see the repo's Actions tab"}`,
    });
  }
  return rows;
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

// ── §7 the site refresh: the OUTCOME, not the heartbeat ─────────────────────
//
// Reads deploy/site-refresh.sh's own report — `report()` writes
// `at · status · town_sha · site_main · release_tag · published · passes ·
// detail` to /srv/postmark-harbor/site-refresh.json, once per run, and every
// failure path writes it too (`die`, and the ERR trap's `on_err`).
//
// THE INSTANCE THIS EXISTS FOR (postmark-town/postmark#2884). At 08:12:35Z on
// 2026-09-17 the box published a town with 48 doors missing, from a three-week-
// old committed snapshot, because fetch-town.mjs warned and exited 0. The board
// read 14 green at 08:20:02Z. Nothing on it was wrong; nothing on it was
// looking at the refresh at all.
//
// FOUR THINGS THIS CLASSIFIER REFUSES TO DO, each one a lesson with a date:
//
//   - IT NEVER MAPS AN UNKNOWN STATUS WORD TO HEALTHY. A `status` this watch
//     does not recognise is UNKNOWN and says the word it saw. The 2026-08-25
//     cancellation finding is the whole reason: a value meaning "nothing was
//     decided" mapped to OK, and the board went all-green on the afternoon the
//     atlas sync was failing on every tick. Nobody-has-checked must never
//     render as checked-and-fine.
//   - IT NEVER CALLS A STALE `published` GREEN. A four-hour-old "published" is
//     a stopped publisher wearing a good verdict.
//   - A FAILURE OUTRANKS ITS AGE. When the newest report is both `failed` and
//     old, the verdict is DOWN and the reason carries BOTH facts — the founder
//     reads "the last refresh failed" and the operator reads "…and nothing has
//     reported since". One verdict, two clocks named, because a thing with two
//     clocks needs two numbers (2026-08-25, (vvv)).
//   - IT SAYS WHICH STAMP IT MEASURED. The age comes from the report's own `at`
//     when that parses and from the file's mtime when it does not, and the
//     STALE sentence names which, because an instrument that will not say what
//     it measured cannot be checked.
//
// Pure, like every classifier above it, so the falsifiers drive every branch
// without a box.
export function classifySiteRefresh({
  exists,
  report = null,
  readError = null,
  atMs = null,
  mtimeMs = null,
  nowMs,
  cadenceMs,
  label,
}) {
  if (!exists) {
    // A fresh box, or a timer installed and not yet fired. Not a failure — and
    // not invisible either: INFO is counted and named in the board's summary.
    return { verdict: "INFO", reason: `${label} has written no report yet — a fresh box, or the timer has not fired since it was installed`, detail: null };
  }
  if (readError != null || report == null || typeof report !== "object") {
    return { verdict: "UNKNOWN", reason: `${label}'s report could not be read${readError ? ` (${readError})` : ""}`, detail: null };
  }

  const detail = typeof report.detail === "string" && report.detail !== "" ? report.detail : null;
  const stampMs = Number.isFinite(atMs) ? atMs : (Number.isFinite(mtimeMs) ? mtimeMs : null);
  const stampName = Number.isFinite(atMs) ? "its own `at` stamp" : "the report file's mtime";
  const ageMin = stampMs == null ? null : Math.round((nowMs - stampMs) / 60_000);
  const stale = stampMs != null && nowMs - stampMs > 3 * cadenceMs;
  const cadenceMin = Math.round(cadenceMs / 60_000);
  const oldTail = stale ? `; and nothing has reported since — ${ageMin} min by ${stampName}, against a ${cadenceMin}-min cadence` : "";
  const ago = ageMin == null ? "at an unreadable time" : `${ageMin} min ago`;

  if (report.status === "failed") {
    // THE `detail` VERBATIM. It is the sentence the founder reads on Discord and
    // now on the site, so it is not summarised, reworded or truncated here.
    return {
      verdict: "DOWN",
      reason: `${label} failed: ${detail ?? "no detail was written"}${oldTail}`,
      detail,
    };
  }

  if (report.status === "published" || report.status === "quiet") {
    if (stale) {
      return {
        verdict: "STALE",
        reason: `${label} last reported ${ageMin} min ago by ${stampName}, against a ${cadenceMin}-min cadence — its newest word is "${report.status}", which stopped being news ${Math.max(0, ageMin - cadenceMin)} min ago`,
        detail,
      };
    }
    if (report.status === "quiet") {
      return { verdict: "OK", reason: `nothing to publish ${ago}${detail ? ` — ${detail}` : ""}`, detail };
    }
    const rel = typeof report.published === "string" && report.published !== ""
      ? report.published.split("/").filter(Boolean).pop()
      : "a release it did not name";
    return { verdict: "OK", reason: `published ${rel} ${ago}`, detail };
  }

  return {
    verdict: "UNKNOWN",
    reason: `${label} reported a status this watch does not know: "${report.status ?? "(absent)"}" — read as unread rather than as healthy${oldTail}`,
    detail,
  };
}

// ── the edge-triggered alert machine ────────────────────────────────────────

export const BAD = new Set(["DOWN", "STALE"]);

/**
 * Decide what to SAY, given what was true last tick and what is true now.
 *
 * The whole point is that a bad state speaks once when it arrives, again only
 * on the long reminder, and once more when it clears. A per-tick ping is not
 * "loud" — it is wallpaper, and the reader stops seeing it, which reproduces
 * the silence this file was built to end.
 *
 * Four edges fire, and one deliberately does not:
 *   - never-seen -> bad ........ fires. A sentinel that boots into an outage
 *                                and says nothing has failed at its only job.
 *   - good -> bad .............. fires.
 *   - bad -> a DIFFERENT bad ... fires. DOWN becoming STALE is new information
 *                                about what is wrong; suppressing it would hide
 *                                a change of failure behind a sameness of mood.
 *   - bad -> OK ................ fires, as a recovery.
 *   - bad -> the SAME bad ...... silent until reminderMs has passed.
 * INFO and UNKNOWN never alert: an info-only door and an unreadable reference
 * are not site outages, and alarming on them teaches the reader to ignore the
 * channel.
 */
export function transition({ prev = null, next, nowMs, reminderMs = CONFIG.reminderMs }) {
  const alertable = BAD.has(next.verdict);
  const wasBad = prev != null && BAD.has(prev.verdict);
  const since = wasBad && prev.verdict === next.verdict ? prev.since : nowMs;

  let alert = null;
  if (alertable) {
    if (!wasBad) alert = { kind: "onset", verdict: next.verdict, reason: next.reason, since };
    else if (prev.verdict !== next.verdict) alert = { kind: "changed", verdict: next.verdict, reason: next.reason, since, from: prev.verdict };
    else if (nowMs - (prev.last_alert_at ?? 0) >= reminderMs) alert = { kind: "reminder", verdict: next.verdict, reason: next.reason, since };
  } else if (wasBad && next.verdict === "OK") {
    alert = { kind: "recovered", verdict: "OK", reason: next.reason, since: prev.since, downFor: nowMs - prev.since };
  }

  const state = {
    verdict: next.verdict,
    reason: next.reason,
    since,
    last_alert_at: alert ? nowMs : (alertable && wasBad ? prev.last_alert_at ?? null : null),
  };
  return { alert, state };
}

// ── the message ─────────────────────────────────────────────────────────────

/**
 * Plain prose. No markdown tables — Discord renders them as garbage, so a table
 * here would make the loudest message the least readable one.
 */
export function composeMessage({ alerts, board, nowIso }) {
  if (!alerts.length) return null;
  const bad = alerts.filter((a) => a.alert.kind !== "recovered");
  const back = alerts.filter((a) => a.alert.kind === "recovered");

  const lines = [];
  if (bad.length && back.length) lines.push(`**📮 Postmark sentinel** — ${bad.length} problem${bad.length > 1 ? "s" : ""} and ${back.length} recovery${back.length > 1 ? "ies" : ""}, as of ${nowIso}.`);
  else if (bad.length) lines.push(`**📮 Postmark sentinel** — ${bad.length === 1 ? "something is" : `${bad.length} things are`} wrong on the site, as of ${nowIso}.`);
  else lines.push(`**📮 Postmark sentinel** — recovered, as of ${nowIso}.`);
  lines.push("");

  for (const { label, alert } of bad) {
    const tail = alert.kind === "reminder" ? ` Still bad after ${humanDuration(Date.parse(nowIso) - alert.since)}; this is the twelve-hourly reminder.`
      : alert.kind === "changed" ? ` (it was ${alert.from} before this)`
      : "";
    lines.push(`${alert.verdict} — ${label}: ${alert.reason}.${tail}`);
  }
  for (const { label, alert } of back) {
    lines.push(`RECOVERED — ${label} is healthy again after ${humanDuration(alert.downFor)}: ${alert.reason}.`);
  }

  lines.push("");
  lines.push(`${board.summary} The full board is ${board.published_at ?? "on the box at /srv/postmark-sentinel/status.json"}.`);
  return lines.join("\n");
}

// ── the board ───────────────────────────────────────────────────────────────

export function composeBoard({ probes, nowIso, alerting }) {
  const counts = { OK: 0, DOWN: 0, STALE: 0, INFO: 0, UNKNOWN: 0 };
  for (const p of probes) counts[p.verdict] = (counts[p.verdict] ?? 0) + 1;
  const worst = counts.DOWN ? "DOWN" : counts.STALE ? "STALE" : counts.UNKNOWN ? "DEGRADED" : "OK";
  // A PARKED PROBE IS COUNTED, NEVER ALARMED, AND NEVER SILENT. INFO is the
  // right verdict for a Stage-B watcher nobody has adopted and for dev's
  // healthy Access redirect — neither is a failure, and alarming on them trains
  // the reader to mute the channel. But `All ${counts.OK} probes green` counted
  // only the OK ones while the word "All" claimed the whole board, so a rail
  // that was built, shipped inert and then forgotten read as a clean tick
  // forever. That is the exact failure the Stage-A/Stage-B split exists to make
  // impossible, and the board was quietly underwriting it.
  const parked = counts.INFO ? ` ${counts.INFO} parked (see the board).` : "";
  const summary =
    worst === "OK" ? (counts.INFO ? `${counts.OK} green.${parked}` : `All ${counts.OK} probes green.`)
      : worst === "DEGRADED" ? `${counts.OK} green, ${counts.UNKNOWN} could not be read.${parked}`
        : `${counts.DOWN} down, ${counts.STALE} stale, ${counts.OK} green.${parked}`;
  return {
    schema: 1,
    generated_at: nowIso,
    status: worst,
    summary,
    // The one line the operator round reads. Kept as its own field so a reader
    // never has to reduce the array themselves and get a different answer.
    headline: `${worst} · ${summary} (${nowIso})`,
    alerting,
    counts,
    probes,
  };
}

// ── adapters (every one injectable, so the whole tick is testable offline) ──

export async function probeUrl(url, { fetchImpl = fetch, timeoutMs = CONFIG.requestTimeoutMs, method = "GET" } = {}) {
  try {
    const res = await fetchImpl(url, {
      method,
      redirect: "manual",
      headers: { "user-agent": CONFIG.userAgent },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: res.status, location: res.headers?.get?.("location") ?? null, headers: res.headers, res };
  } catch (e) {
    return { error: e?.message ?? String(e) };
  }
}

/**
 * A ref's SHA over the git wire protocol.
 *
 * `git ls-remote` and not the REST API on purpose — see the header's budget
 * note. It also means the reference for "is the site current" never depends on
 * the box's own clone, which matters: a clone the box failed to pull is exactly
 * the condition being tested for, and using it as the reference would compare
 * a stale answer against itself and call them equal.
 */
export function lsRemote(repoUrl, ref, { exec = execFileSync } = {}) {
  try {
    const out = String(exec("git", ["ls-remote", repoUrl, ref], { encoding: "utf8", timeout: CONFIG.requestTimeoutMs }));
    const line = out.split("\n").find((l) => l.trim());
    return line ? line.split(/\s+/)[0] : null;
  } catch { return null; }
}

/** The newest release/* tag's name, by version-ish sort over the tag list. */
export function newestReleaseTag(repoUrl, { exec = execFileSync } = {}) {
  try {
    // NO --refs, on purpose (2026-08-26). An ANNOTATED tag lists twice on the
    // wire: `refs/tags/X` (the tag OBJECT's sha) and `refs/tags/X^{}` (the
    // peeled COMMIT the deploy actually checks out). `--refs` strips the
    // peeled lines, so this probe compared the deployed build against the tag
    // object and called a perfectly current site STALE for 9 hours. The
    // peeled sha wins whenever it exists; a lightweight tag has no ^{} line
    // and its ref sha IS the commit, unchanged.
    const out = String(exec("git", ["ls-remote", "--tags", repoUrl, "release/*"], { encoding: "utf8", timeout: CONFIG.requestTimeoutMs }));
    const byTag = new Map();
    for (const l of out.split("\n").filter(Boolean)) {
      const [sha, ref] = l.split(/\s+/);
      const peeled = /\^\{\}$/.test(ref);
      const tag = String(ref).replace("refs/tags/", "").replace(/\^\{\}$/, "");
      const row = byTag.get(tag) ?? { tag, sha: null };
      if (peeled || row.sha === null) row.sha = sha;
      byTag.set(tag, row);
    }
    const rows = [...byTag.values()];
    if (!rows.length) return null;
    rows.sort((a, b) => a.tag.localeCompare(b.tag, undefined, { numeric: true }));
    return rows[rows.length - 1];
  } catch { return null; }
}

export async function ghJson(path, { fetchImpl = fetch, token = null } = {}) {
  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": CONFIG.userAgent,
    "x-github-api-version": "2022-11-28",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetchImpl(`https://api.github.com${path}`, { headers, signal: AbortSignal.timeout(CONFIG.requestTimeoutMs) });
  if (!res.ok) throw new Error(`GET ${path} -> HTTP ${res.status}`);
  return res.json();
}

export async function postDiscord(webhook, content, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(webhook, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": CONFIG.userAgent },
    body: JSON.stringify({ content: content.slice(0, 1900), allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(CONFIG.requestTimeoutMs),
  });
  if (!res.ok) throw new Error(`webhook -> HTTP ${res.status}`);
  return true;
}

// ── one tick ────────────────────────────────────────────────────────────────

/**
 * Read everything, classify everything, decide what to say. Persists NOTHING —
 * the caller owns the filesystem and the webhook, so a falsifier can run a
 * whole tick, inspect the alerts it WOULD have sent, and prove the state it
 * would have written, without a box or a network.
 */
export async function tick({
  fetchImpl = fetch,
  exec = execFileSync,
  state = {},
  nowMs = Date.now(),
  config = CONFIG,
  token = null,
} = {}) {
  const nowIso = new Date(nowMs).toISOString();
  const probes = [];
  const stamps = { ...(state.stamps ?? {}) };
  const notes = [];

  // §1 — the doors, all at once. The API's response is kept: probe 3 reads its
  // as-of header rather than opening the door a second time.
  const doorResults = await Promise.all(config.doors.map((d) => probeUrl(d.url, { fetchImpl })));
  let servedAsOf = null;
  let officeApiRes = null;
  config.doors.forEach((d, i) => {
    const r = doorResults[i];
    const { verdict, reason } = classifyUp(r);
    probes.push({ key: d.key, label: d.label, kind: "up", verdict, reason, url: d.url });
    if (d.key === "office_api") {
      servedAsOf = r.headers?.get?.("x-postmark-as-of") ?? null;
      officeApiRes = r.res ?? null;
    }
  });

  // The crossing rides the manifest we ALREADY opened for §1 and §3 — the same
  // response object, read for its body this time, so the event-shaped probe
  // below costs the watch not one extra request. An office that answers without
  // a crossing field (an older office) leaves this null, and classifyCrossing
  // reads null as UNKNOWN, never as green.
  let officeCrossing = null;
  try {
    const manifest = officeApiRes ? await officeApiRes.json() : null;
    if (Number.isInteger(manifest?.crossing?.number)) officeCrossing = manifest.crossing.number;
  } catch { /* a body that will not parse is an unread crossing, not a site outage */ }

  const devR = await probeUrl(config.devDoor.url, { fetchImpl });
  {
    const { verdict, reason } = classifyUp({ ...devR, infoOnly: true });
    probes.push({ key: config.devDoor.key, label: config.devDoor.label, kind: "up", verdict, reason, url: config.devDoor.url });
  }

  // §2 — the site's two shas, each against its own reference.
  const siteUrl = `https://github.com/${config.siteRepo.owner}/${config.siteRepo.name}.git`;
  const townUrl = `https://github.com/${config.townRepo.owner}/${config.townRepo.name}.git`;
  const stamp = await readJson(config.buildStamp, { fetchImpl });
  const siteMainTip = lsRemote(siteUrl, "main", { exec });
  const releaseTag = newestReleaseTag(siteUrl, { exec });

  // §2b — THE CROSSING, and it is deliberately outside the `if (!stamp)` branch
  // below: an absent stamp is exactly the condition this probe must still speak
  // about, and classifyCrossing's own UNKNOWN says why in words a reader can act
  // on, rather than being folded into a generic "no /build.json".
  const cr = classifyCrossing({
    haveStamp: Boolean(stamp),
    servedCrossing: Number.isInteger(stamp?.crossing) ? stamp.crossing : null,
    officeCrossing, nowMs, graceMs: config.crossingGrace,
  });
  probes.push({ key: "site_crossing", label: "the crossing the site is showing", kind: "fresh", verdict: cr.verdict, reason: cr.reason });

  // §2c — WHAT THE BUILD THAT PUBLISHED THIS SITE COULD NOT GET. Outside the
  // `if (!stamp)` branch for the same reason §2b is: an absent stamp is a
  // condition this probe must speak about in its own words, not one it should
  // vanish into. `stamp.problems` is `undefined` when the key is absent (an
  // older stamper) and `null` when a POS-180 stamper could not read its own
  // manifest, and those are two different sentences — see classifyProblems.
  const pr = classifyProblems({ haveStamp: Boolean(stamp), problems: stamp ? stamp.problems : undefined });
  probes.push({ key: "site_build_problems", label: "what the site's build could not get", kind: "fresh", verdict: pr.verdict, reason: pr.reason });

  if (!stamp) {
    notes.push(`no build stamp at ${config.buildStamp} — the site's own freshness cannot be read until the site repo emits one (see tools/build-stamp.mjs in postmark-site)`);
    probes.push({ key: "site_code", label: "the deployed site code", kind: "fresh", verdict: "UNKNOWN", reason: `no /build.json on the deployed site` });
    probes.push({ key: "site_town_data", label: "the deployed town data", kind: "fresh", verdict: "UNKNOWN", reason: `no /build.json on the deployed site` });
  } else {
    // Prod rides the release tag; comparing its code against MAIN would alarm
    // forever, because lagging main is the design (deploy.yml's release lane).
    const codeRef = stamp.channel === "release" ? (releaseTag?.sha ?? null) : siteMainTip;
    const codeRefName = stamp.channel === "release" ? `the newest release tag (${releaseTag?.tag ?? "none cut yet"})` : "site main's tip";
    const c = classifyStamp({
      served: stamp.code_sha ?? null, reference: codeRef, seen: stamps.site_code, nowMs,
      staleAfterMs: config.staleAfter.site_code, what: "the deployed site code", referenceName: codeRefName,
    });
    stamps.site_code = c.seen; probes.push({ key: "site_code", label: "the deployed site code", kind: "fresh", verdict: c.verdict, reason: c.reason });

    // The half that froze on 2026-08-24 while the code was correctly pinned.
    //
    // KEPT AS THE FLOOR, not replaced by §2b. Once the box timer owns prod's
    // content and sync-atlas.yml's schedule is retired, site main stops moving
    // every half hour — so this comparison spends most of its life served ===
    // reference, which the file's own staleness-clock note already covers: "a
    // quiet repo never alarms, because when nothing is pushed the served value
    // equals the reference and the comparison never opens." It stays because it
    // is the probe that still speaks when the crossing probe cannot: no office,
    // no crossing field, an old stamper. Three hours of wall clock under an
    // event-shaped hour.
    const t = classifyStamp({
      served: stamp.town_data_sha ?? null, reference: siteMainTip, seen: stamps.site_town_data, nowMs,
      staleAfterMs: config.staleAfter.site_town_data, what: "the deployed town data", referenceName: "site main's tip",
    });
    stamps.site_town_data = t.seen; probes.push({ key: "site_town_data", label: "the deployed town data", kind: "fresh", verdict: t.verdict, reason: t.reason });
  }

  // §3 — the office index against the town's own tip.
  const townTip = lsRemote(townUrl, "main", { exec });
  const a = classifyStamp({
    served: servedAsOf, reference: townTip, seen: stamps.office_as_of, nowMs,
    staleAfterMs: config.staleAfter.office_as_of, what: "the office's served index (X-Postmark-As-Of)", referenceName: "the town repo's main tip",
  });
  stamps.office_as_of = a.seen;
  probes.push({ key: "office_as_of", label: "the office's read index", kind: "fresh", verdict: a.verdict, reason: a.reason });

  // §4 — the daily, as an outcome. REST call 1 of 2 (the source's commit date).
  const sourceMd = await readText(config.dailySource, { fetchImpl });
  const servedDaily = await readText(config.dailyServed, { fetchImpl });
  let dailyCommittedAt = null;
  try {
    const commits = await ghJson(`/repos/${config.townRepo.owner}/${config.townRepo.name}/commits?path=${encodeURIComponent(config.dailyPath)}&per_page=1`, { fetchImpl, token });
    dailyCommittedAt = Date.parse(commits?.[0]?.commit?.committer?.date ?? "") || null;
  } catch (e) { notes.push(`daily commit date unread: ${e.message}`); }
  const d = classifyDaily({
    fingerprint: sourceMd ? dailyFingerprint(sourceMd) : null,
    servedHtml: servedDaily, sourceCommittedAtMs: dailyCommittedAt, nowMs, slackMs: config.dailySlack,
  });
  probes.push({ key: "site_daily_content", label: "Ferry's Daily on the site", kind: "fresh", verdict: d.verdict, reason: d.reason });

  // §5 — the workflows. REST call 2 of 2: ONE read covers every workflow.
  try {
    const runs = await ghJson(`/repos/${config.siteRepo.owner}/${config.siteRepo.name}/actions/runs?branch=main&per_page=50`, { fetchImpl, token });
    for (const row of classifyWorkflows(latestDecisiveRunPerWorkflow(runs?.workflow_runs ?? []))) {
      probes.push({ ...row, label: `the "${row.workflow}" workflow`, kind: "workflow" });
    }
  } catch (e) {
    notes.push(`workflow conclusions unread: ${e.message}`);
    probes.push({ key: "workflow_read", label: "the site's workflow conclusions", kind: "workflow", verdict: "UNKNOWN", reason: `GitHub did not answer: ${e.message}` });
  }

  // §6 — the watchers themselves. Local stat, no network, no budget.
  for (const w of config.watchers ?? []) {
    const adopted = w.adoptedWhen ? existsSync(w.adoptedWhen) : true;
    const exists = adopted && existsSync(w.state);
    const mtimeMs = exists ? statSync(w.state).mtimeMs : null;
    const { verdict, reason } = classifyWatcher({ adopted, exists, mtimeMs, nowMs, cadenceMs: w.cadenceMs, label: w.label });
    probes.push({ key: w.key, label: w.label, kind: "watcher", verdict, reason });
  }

  // §7 — the box's own publisher. A local read, no network, no keyless budget:
  // the report sits on the same disk this process runs on.
  const sr = config.siteRefresh;
  if (sr) {
    const exists = existsSync(sr.report);
    let report = null;
    let readError = null;
    let atMs = null;
    let mtimeMs = null;
    if (exists) {
      mtimeMs = statSync(sr.report).mtimeMs;
      try {
        report = JSON.parse(readFileSync(sr.report, "utf8"));
      } catch (e) {
        readError = e.message;
      }
      const parsed = Date.parse(report?.at ?? "");
      atMs = Number.isFinite(parsed) ? parsed : null;
    }
    const r = classifySiteRefresh({ exists, report, readError, atMs, mtimeMs, nowMs, cadenceMs: sr.cadenceMs, label: sr.label });
    // `detail` rides onto the board so the site's header popover can say "48
    // doors are missing" rather than only "failed" — postmark-site#97 reads it.
    probes.push({ key: sr.key, label: sr.label, kind: "refresh", verdict: r.verdict, reason: r.reason, ...(r.detail ? { detail: r.detail } : {}) });
  }

  // the edges
  const prevProbes = state.probes ?? {};
  const nextProbes = {};
  const alerts = [];
  for (const p of probes) {
    const { alert, state: st } = transition({ prev: prevProbes[p.key] ?? null, next: p, nowMs, reminderMs: config.reminderMs });
    nextProbes[p.key] = st;
    if (alert) alerts.push({ key: p.key, label: p.label, alert });
  }

  return { probes, alerts, notes, nextState: { schema: 1, probes: nextProbes, stamps, last_run: nowIso }, nowIso };
}

async function readText(url, { fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl(url, { headers: { "user-agent": CONFIG.userAgent }, signal: AbortSignal.timeout(CONFIG.requestTimeoutMs) });
    return res.ok ? await res.text() : null;
  } catch { return null; }
}

async function readJson(url, opts) {
  const t = await readText(url, opts);
  if (t == null) return null;
  try { return JSON.parse(t); } catch { return null; }
}

// ── the CLI ─────────────────────────────────────────────────────────────────

export const readState = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return {}; } };
export function writeJson(p, o) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(o, null, 2) + "\n"); }

/**
 * Whether the alert channel exists, said as data.
 *
 * Degrading VISIBLY is the point. A watch whose channel is unconfigured must
 * still take every reading and still write its board, and must say — on stderr
 * AND on the board itself — that nothing was sent. The one thing it must never
 * do is fall quiet, because a silent sentinel is indistinguishable from a
 * healthy town, and that indistinguishability IS the failure this file exists
 * to end: "how can we LOUDLY BE NOTIFIED when something is down on the site?"
 */
export function alertingStatus(env = process.env) {
  const webhook = env.SENTINEL_DISCORD_WEBHOOK || null;
  return webhook
    ? { webhook, status: { channel: "discord", configured: true } }
    : {
      webhook: null,
      status: {
        channel: "discord",
        configured: false,
        note: "SENTINEL_DISCORD_WEBHOOK is unset — every reading on this board was taken and NOTHING WAS SENT. Set it in /etc/postmark-sentinel.env (deploy/DEPLOY.md § the sentinel).",
      },
    };
}

/**
 * The whole CLI, with every dependency injectable so a falsifier can run the
 * real thing — state file, board file, delivery decision, exit path — with no
 * network and no box.
 */
export async function run({
  argv = process.argv,
  env = process.env,
  fetchImpl = fetch,
  exec = execFileSync,
  nowMs = null,
  log = console.log,
  errLog = console.error,
} = {}) {
  const a = (name, dflt = null) => {
    const i = argv.indexOf(`--${name}`);
    return i > -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : dflt;
  };
  const statePath = a("state", join(HERE, "..", ".site-sentinel-state.json"));
  const outPath = a("out", null);
  const dryRun = argv.includes("--dry-run");
  const at = nowMs ?? (a("now") ? Date.parse(a("now")) : Date.now());

  const { webhook, status: alerting } = alertingStatus(env);
  if (!webhook) errLog("site-sentinel: LOUD DEGRADATION — SENTINEL_DISCORD_WEBHOOK is unset; probes ran, the board was written, and no alert could be delivered.");

  // Optional. Both repos are public, so the watch works keyless at 60 REST/hour
  // and merely spends less of the shared budget when the box's existing
  // read-only token is present.
  let token = null;
  try { token = readFileSync(env.SENTINEL_GITHUB_TOKEN_FILE ?? "/srv/postmark-office/git-metrics-token", "utf8").trim() || null; } catch { token = null; }

  const { probes, alerts, notes, nextState, nowIso } = await tick({ fetchImpl, exec, state: readState(statePath), nowMs: at, token });
  const board = composeBoard({ probes, nowIso, alerting: { ...alerting, notes } });
  if (outPath) { board.published_at = outPath; writeJson(outPath, board); }

  const message = composeMessage({ alerts, board, nowIso });
  let delivered = null;
  if (message && webhook && !dryRun) {
    try { await postDiscord(webhook, message, { fetchImpl }); delivered = true; }
    catch (e) { delivered = false; errLog(`site-sentinel: the webhook refused the alert (${e.message}) — the alert text follows so it is not lost:\n${message}`); }
  } else if (message) {
    errLog(`site-sentinel: ${dryRun ? "--dry-run" : "no webhook"}; the alert that would have been sent:\n${message}`);
  }

  // The state advances even when delivery failed: a delivery that failed twice
  // must not re-announce an onset it already announced once. The failure is
  // loud on stderr and the journal keeps it.
  writeJson(statePath, nextState);

  if (argv.includes("--json")) { log(JSON.stringify(board, null, 2)); return { board, alerts, delivered, message }; }
  log(`site-sentinel: ${board.headline}`);
  for (const p of probes) if (p.verdict !== "OK" && p.verdict !== "INFO") log(`  ${p.verdict}  ${p.label} — ${p.reason}`);
  // The terminal and the board must agree about what is worth saying. This loop
  // used to skip INFO with everything else that was not broken, so an operator
  // running the sentinel by hand saw NOTHING about a rail that had never been
  // switched on. Printed last and named PARKED, not alarmed.
  for (const p of probes) if (p.verdict === "INFO") log(`  PARKED  ${p.label} — ${p.reason}`);
  for (const n of notes) log(`  note: ${n}`);
  if (alerts.length) log(`  ${alerts.length} alert(s) ${delivered === true ? "delivered" : delivered === false ? "NOT delivered (webhook refused)" : "not sent"}`);
  return { board, alerts, delivered, message };
}

// ── entry guard ──────────────────────────────────────────────────────────────
// The junction lesson (2026-09-05, HQ memory `junctions-defeat-main-guards`):
// `pathToFileURL(process.argv[1]).href === import.meta.url` is FALSE when the
// entry path reaches this file through a Windows junction — the ESM loader
// realpaths the entry, argv[1] is not — so the tool exits 0 having done nothing.
// Compare real paths (world2/tools/await-clearing.mjs's idiom); the URL compare is
// only the fallback for an argv[1] that cannot be realpath'd. The office's
// test/cli-guard.test.mjs imports this file and spawns it through a junction.
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) {
  run().catch((e) => { console.error(`site-sentinel FATAL: ${e?.stack ?? e}`); process.exit(1); });
}
