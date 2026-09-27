// box-rollcall — the roll-call of every mechanism that is supposed to be RUNNING.
//
// Built 2026-08-27 to close a failure class the town hit three times in one week,
// and the founder's sentence is the whole specification:
//
//     "A box roll-call exists: a manifest of every unit that must run with its
//      expected heartbeat, a checker that emits ALARM for missing or stale,
//      wired into my daily operator round … OPERATIONS.md carries the law: a
//      mechanism folds only with its runner, its liveness check, and its
//      activation owner named. 'Built' is not 'done.'"
//
// ── THE FAILURE CLASS, WITH ITS RECEIPTS ────────────────────────────────────
//
// Machinery gets BUILT and never RUN, and nothing anywhere goes red. Four
// instances, all live on 2026-08-27 when this file was written:
//
//  1. THE WORLD DRAIN NEVER HAD A RUNNER (postmark#1990). The function existed,
//     was correct, was tested, and had no caller — marks aged 2+ days in a
//     journal nobody drained.
//  2. THE SETTLEMENT SHADOW IS DISABLED AND ITS VERDICT IS ROTTING.
//     postmark-settlement-shadow.timer is `disabled` on the box; the verdict on
//     disk at /srv/postmark-harbor/settlement-shadow.json reads
//     {"at":"2026-08-24T22:23:00Z","status":"would-refuse"} — a WOULD-REFUSE, the
//     exact finding the shadow exists to raise — 2 days 8 hours old when it was
//     measured, and unread by anything the whole time. Its own script header says
//     the verdict is "polled by the ops page and
//     read on the operator round"; no step of the operator round reads it. That
//     sentence has been false since the day it was written.
//  3. THE ECONOMY REPORT'S TIMER IS OWED, and OPERATIONS.md § Known gaps has
//     said so since 2026-08-10 without anything alarming about it.
//  4. THE STRIPE WATCHER — this one is the CONTROL, and it is why PARKED is a
//     first-class verdict here. It was built 2026-08-25 and is not installed on
//     the box; that is correct and deliberate (its unit file says "STAGE B. NOT
//     INSTALLED, NOT ENABLED, INERT UNTIL ADOPTED"). A roll-call that simply
//     omitted it would make a deliberate parking indistinguishable from an
//     oversight — which is the same blindness one layer up.
//
// The one thing all four share: THERE WAS NO SURFACE ON WHICH THE ABSENCE OF A
// RUNNER WAS VISIBLE. Every other check in this repo asks whether a thing that
// ran produced the right answer. This one asks whether it ran at all.
//
// ── THE FOUR DESIGN RULES, EACH BOUGHT WITH A MEASUREMENT ───────────────────
//
// 1. A HEARTBEAT IS ONLY EVIDENCE OF A RUNNER IF THE RUNNER EXISTS AND IS
//    ENABLED. Measured on the box 2026-08-27: /srv/postmark-office/.stripe-watch-state.json
//    carried last_run 2026-08-27T04:04:34Z — four minutes fresh — while
//    postmark-stripe-watch.timer did not exist on the machine at all. A hand-run
//    wrote it. A checker that ranked freshness first would have called a rail
//    with no runner healthy, on the strength of a file a human touched. So the
//    unit is judged BEFORE the heartbeat, always, and a stale-looking heartbeat
//    on a dead unit reports the dead unit.
//
// 2. THE CADENCE COMES FROM `systemctl show`, NEVER FROM THE TIMER FILE. Measured
//    on the box 2026-08-27: /etc/systemd/system/postmark-dev-freshen.timer says
//    `OnCalendar=*:0/10` and even calls itself "every 10 minutes" in its own
//    Description — while the drop-in at .timer.d/nightly.conf clears that line and
//    substitutes `OnCalendar=*-*-* 08:10:00 UTC`. The effective cadence is DAILY.
//    A checker reading the file would have been wrong by a factor of 144 and would
//    have alarmed on a healthy rail every ten minutes forever. `systemctl show
//    -p TimersCalendar` returns the merged, effective value; that is the only
//    number this file will believe. (Sibling of the site-sentinel's own scar: its
//    stripe_watch probe once quoted a cadence the box did not run.)
//
// 3. A LIVE ROW THAT DECLARES NO STALENESS ALLOWANCE IS ITSELF AN ALARM. This is
//    instance 2 above, generalised. The shadow's verdict file has no field saying
//    when it goes off, so nothing on the box or in the repo could ever have said
//    it was old — it was served stale for sixty hours and every surface that
//    touched it reported exactly what it said. An un-allowanced heartbeat is not
//    a healthy heartbeat; it is a heartbeat nobody can check, and ALARM-unbounded
//    exists so that a lazily-written manifest row fails loudly instead of quietly
//    passing forever.
//
// 4. THE ROLL-CALL IS TWO-DIRECTIONAL. A manifest row with no unit is one failure
//    (something we swore would run, does not). A unit with no manifest row is the
//    OTHER failure, and it is the one that grows silently: every unit installed
//    after this file was written is invisible to the roll-call until someone adds
//    it. So the collector globs the box for every postmark-* timer and every
//    ENABLED postmark-* service, and anything it finds that the manifest does not
//    name is ALARM-unmanifested. That is what keeps the roll-call from decaying
//    into a snapshot of 2026-08-27.
//
// ── WHAT IT WILL NOT DO ─────────────────────────────────────────────────────
//
// It reads and reports. It never enables, disables, restarts, or writes a unit.
// Detection is mechanical here; the repair stays a hand — the same posture as
// harbor-watch and site-sentinel, and for the same reason (the 2026-08-19
// stranded-crossings incident is the town's receipt for an unwatched automatic
// hand).
//
// It also cannot see its own death, and NEITHER CAN IT SEE THE BOX'S. It runs on
// the box; if the box is down it does not run and therefore does not alarm. That
// is the classic watchman problem and it is NOT solved here — solving it needs an
// off-box heartbeat, which is a second machine. Named rather than papered over,
// because a roll-call that implies coverage it does not have is worse than none.
// What the wiring DOES give: the operator round runs it over ssh once a day, so a
// box that cannot be reached fails the ssh and the operator sees that instead.
//
// ── SHAPE ───────────────────────────────────────────────────────────────────
//
// `collect()` is the only impure part: it shells out to systemctl and stat. Every
// judgment lives in `rollcall()`, which is a pure function of (manifest, snapshot,
// now) — so the falsifiers plant a healthy snapshot as a fixture, break exactly
// one thing, and watch exactly one row go red.
//
// Usage:
//   node tools/box-rollcall.mjs                          # collect on the box, judge, print
//   node tools/box-rollcall.mjs --snapshot snap.json     # judge a captured snapshot
//   node tools/box-rollcall.mjs --dump-snapshot snap.json # collect, save, AND judge
//   node tools/box-rollcall.mjs --json                   # machine-readable
// Exit: 0 = every row OK or PARKED · 1 = at least one ALARM · 2 = the roll-call
// itself could not run (no manifest, unreadable manifest, systemctl absent).

import { readFileSync, writeFileSync, existsSync, statSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ── ONE READER OF THE SETTLEMENT HISTORY (postmark#2979, 2026-09-21) ─────────
//
// deploy/settlement-history.mjs is the one law of the settlement log: it writes
// the lines, and it owns what they mean. This file used to keep its own copy of
// half of that — its own `UNSETTLED` status set and its own unfiltered window —
// so after postmark#2974 taught the crossing's 05:45Z escalation to ask its
// question of SCHEDULED lines only, the escalation and the board an operator
// reads at 8am could disagree about the same log. The one disagreeing by being
// WRONG was the board: a person publishing by hand between two refusals broke
// the run and silenced it, which is exactly the reading #2786 forbids — a
// person rescuing the town by hand is not the timer being healthy.
//
// THE EDGE IS SAFE BECAUSE BOTH DIRECTORIES SHIP FROM ONE TAG. The box runs
// this file as `$OFFICE/tools/box-rollcall.mjs` (deploy/box-rollcall.sh, with
// OFFICE=/srv/postmark-office) and runs the module below as
// `$OFFICE/deploy/settlement-history.mjs` (postmark-settlement.service, same
// root), and release-train.yml syncs every top-level directory the tag carries
// except telemetry/ and .github/ — so the two cannot be skewed by a release.
// A HAND-CARRY OF THIS FILE ALONE could still ship a reader older than what it
// imports; the hand-carry recipe in deploy/DEPLOY.md is where that is answered.
import { readHistory, recurringUnsettled, scheduledRuns } from "../deploy/settlement-history.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MANIFEST = join(HERE, "..", "deploy", "box-rollcall-manifest.json");

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

// ── §1 verdicts ─────────────────────────────────────────────────────────────
//
// One verdict per row, most severe first. The ordering is not cosmetic: it
// decides which single sentence the operator reads at 8:05 in the morning, and
// the rule is that it should be the one they can ACT on. A dead unit outranks a
// stale file because starting the unit fixes both; a failed run outranks a stale
// file for the same reason.

export const OK = "OK";
export const PARKED = "PARKED";
export const ALARM_MISSING = "ALARM-missing";
export const ALARM_UNBOUNDED = "ALARM-unbounded";
export const ALARM_DISABLED = "ALARM-disabled";
export const ALARM_FAILED = "ALARM-failed";
export const ALARM_NOHEARTBEAT = "ALARM-noheartbeat";
export const ALARM_STALE = "ALARM-stale";
export const ALARM_UNPARKED = "ALARM-unparked";
export const ALARM_UNMANIFESTED = "ALARM-unmanifested";
// A rail that ran, on time, and produced the wrong thing. Every verdict above
// this one asks whether the machinery moved; this one is the first that reads
// what came out of it. (2026-08-30 — the settlement row judged timer recency
// alone, so a crossing refusing identically twice a day read as a green tick.)
export const ALARM_OUTCOME = "ALARM-outcome";
// Somebody else owns the files a service must write. Its own class because the
// repair is `chown`, not `systemctl` — see §2b in the manifest's readme.
export const ALARM_CUSTODY = "ALARM-custody";
// The unit is up, on time, and RUNNING CODE THAT IS NOT THE DEPLOYED RELEASE.
// Its own class because the repair is neither `systemctl` nor `chown` — it is a
// drop-in, a symlink, or a file copy that the release workflow never performs.
// See §2c in the manifest's readme for the incident that earned it.
export const ALARM_TREE = "ALARM-tree";

export function isAlarm(verdict) {
  return String(verdict).startsWith("ALARM");
}

// ── §2 the manifest ─────────────────────────────────────────────────────────

/** The units[] row that decides whether a .service is live or parked — itself, or
 *  the .timer that triggers it. Tree rows do not carry their own `stage`: two
 *  places to park one rail is two places to forget. */
export function unitRowGoverning(manifest, serviceUnit) {
  const timer = serviceUnit.replace(/\.service$/, ".timer");
  return manifest.units.find((r) => r.unit === serviceUnit) || manifest.units.find((r) => r.unit === timer) || null;
}

export function loadManifest(path = DEFAULT_MANIFEST) {
  const raw = readFileSync(path, "utf8");
  const m = JSON.parse(raw);
  if (!Array.isArray(m.units)) throw new Error(`manifest at ${path} has no units[]`);
  for (const row of m.units) {
    if (!row.unit) throw new Error(`manifest row with no unit name: ${JSON.stringify(row)}`);
    if (row.stage !== "live" && row.stage !== "parked") {
      throw new Error(`manifest row ${row.unit} has stage ${JSON.stringify(row.stage)} — must be "live" or "parked"`);
    }
    if (!row.activation_owner) {
      // The law's third clause is not decorative. A row that cannot say who
      // decided it runs is a row nobody will fix when it goes red.
      throw new Error(`manifest row ${row.unit} names no activation_owner`);
    }
  }
  // §2b, the custody rows. Optional as a block, strict inside it: the same
  // discipline as units, because a custody row that cannot say who should own
  // the files is a row nobody can act on either.
  for (const row of m.custody ?? []) {
    if (!row.id) throw new Error(`custody row with no id: ${JSON.stringify(row)}`);
    if (!row.path) throw new Error(`custody row ${row.id} names no path`);
    if (!row.must_be_owned_by) throw new Error(`custody row ${row.id} names no must_be_owned_by`);
    if (!row.why) throw new Error(`custody row ${row.id} does not say what breaks when custody slips`);
  }
  // §2c, the tree rows. Same discipline again, and one clause of its own: a row
  // that permits a tree OTHER than the deployed release must say why in a
  // sentence, because "this one is allowed to be different" is also what the
  // row would say if somebody had simply pointed it wrong and silenced the alarm.
  if (m.trees) {
    if (!m.trees.release_root) throw new Error(`the trees block names no release_root — nothing can say which tree is the right one`);
    if (!Array.isArray(m.trees.rows)) throw new Error(`the trees block has no rows[]`);
    for (const row of m.trees.rows) {
      if (!row.id) throw new Error(`tree row with no id: ${JSON.stringify(row)}`);
      if (!row.activation_owner) throw new Error(`tree row ${row.id} names no activation_owner`);
      if (!row.why) throw new Error(`tree row ${row.id} does not say what breaks when the tree drifts`);
      if (row.kind === "file_copy") {
        if (!row.path) throw new Error(`tree row ${row.id} is a file_copy and names no path on the box`);
        if (!row.from) throw new Error(`tree row ${row.id} is a file_copy and names no directory in the release to compare against`);
        continue;
      }
      if (!row.unit) throw new Error(`tree row ${row.id} names no unit`);
      if (!row.unit.endsWith(".service")) {
        // The tree belongs to the thing that EXECS, and a timer execs nothing.
        // A row pointed at a timer would read WorkingDirectory= off a unit that
        // has never had one and report the lib default forever.
        throw new Error(`tree row ${row.id} names ${row.unit} — a tree row must name the .service that execs, never the timer`);
      }
      if (!row.must_be) throw new Error(`tree row ${row.id} names no must_be — "release", or the literal path it is allowed to run instead`);
      if (row.must_be !== "release" && !row.divergence_because) {
        throw new Error(`tree row ${row.id} allows the tree ${row.must_be} instead of the release and does not say why — a row that can excuse itself without a sentence is how a wrong tree gets silenced`);
      }
      // Exactly one unit row must govern it, so the stage answer has one source.
      if (!unitRowGoverning(m, row.unit)) {
        throw new Error(`tree row ${row.id} names ${row.unit}, which no manifest unit row governs (neither it nor its .timer is in units[]) — a tree row nobody rolls-call is a check on a rail that may not exist`);
      }
    }
  }
  // The same discipline on an outcome block: the short sentence the board prints
  // and the long one a reviewer weighs are different jobs, and a row that only
  // has the long one puts a paragraph on the board every morning.
  for (const row of m.units) {
    if (!row.outcome) continue;
    if (!row.outcome.history_path) throw new Error(`${row.unit} declares an outcome with no history_path`);
    if (!Number.isFinite(Number(row.outcome.unsettled_runs))) throw new Error(`${row.unit} declares an outcome with no unsettled_runs — a refusal that keeps returning would read green`);
    if (!row.outcome.means) throw new Error(`${row.unit} declares an outcome with no means — nothing to print on the alarm line`);
    if (!row.outcome.why) throw new Error(`${row.unit} declares an outcome with no why — its thresholds are numbers nobody can review`);
    // A list-alarm names the fields it watches, and an empty declaration is the
    // shape that reads green forever: `alarm_on_nonempty: []` would pass every
    // check above and watch nothing.
    if (Object.prototype.hasOwnProperty.call(row.outcome, "alarm_on_nonempty")) {
      const l = row.outcome.alarm_on_nonempty;
      if (!Array.isArray(l) || !l.length || l.some((f) => typeof f !== "string" || !f))
        throw new Error(`${row.unit} declares alarm_on_nonempty that names no field — a list-alarm watching nothing reads green forever`);
      // Its own sentence, always — never the shared one, whose install-day note
      // would excuse a finding that is never install-day noise.
      if (!row.outcome.list_means)
        throw new Error(`${row.unit} declares alarm_on_nonempty with no list_means — it would print the shared means, whose install-day excuse is false of a named slug`);
    }
    // Same discipline for the present-and-false alarm: a flag list naming no
    // field watches nothing, and one without its own sentence borrows a means
    // that sends the operator after the wrong cause.
    if (Object.prototype.hasOwnProperty.call(row.outcome, "alarm_on_false")) {
      const f = row.outcome.alarm_on_false;
      if (!Array.isArray(f) || !f.length || f.some((x) => typeof x !== "string" || !x))
        throw new Error(`${row.unit} declares alarm_on_false that names no field — a flag-alarm watching nothing reads green forever`);
      if (!row.outcome.unchecked_means)
        throw new Error(`${row.unit} declares alarm_on_false with no unchecked_means — a check that did not run has a different repair from a check that found something`);
    }
    // And for the count that is NOT an alarm (postmark#2935): a declaration
    // naming no field prints nothing forever, and one with no sentence prints a
    // bare number the operator cannot read.
    if (Object.prototype.hasOwnProperty.call(row.outcome, "report_counts")) {
      const c = row.outcome.report_counts;
      if (!Array.isArray(c) || !c.length || c.some((x) => typeof x !== "string" || !x))
        throw new Error(`${row.unit} declares report_counts that names no field — a count line reporting nothing is a line nobody reads`);
      if (!row.outcome.count_means)
        throw new Error(`${row.unit} declares report_counts with no count_means — a bare number on the board is a number nobody can read`);
      const alarmed = c.filter((x) => (row.outcome.alarm_on_nonempty ?? []).includes(x) || (row.outcome.alarm_on_false ?? []).includes(x));
      if (alarmed.length)
        throw new Error(`${row.unit} names ${alarmed.join(", ")} in report_counts AND in an alarm list — a count is not an alarm, and one field cannot be both`);
    }
  }
  return m;
}

// ── §3 collection (the only impure part) ────────────────────────────────────

function systemctl(args) {
  try {
    return execFileSync("systemctl", args, { encoding: "utf8", timeout: 20_000 });
  } catch (err) {
    // `systemctl show` exits 0 even for a unit that does not exist (it answers
    // LoadState=not-found), so a throw here means systemctl itself is missing or
    // the call was malformed — not a missing unit.
    if (err && err.stdout) return String(err.stdout);
    throw err;
  }
}

function showProps(unit, props) {
  const out = systemctl(["show", unit, ...props.map((p) => `-p${p}`)]);
  const kv = Object.create(null);
  for (const line of out.split("\n")) {
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    kv[line.slice(0, eq)] = line.slice(eq + 1).trim();
  }
  return kv;
}

// systemd prints usec fields as either a microsecond integer (…Monotonic) or a
// human date. Both shapes appear on the same box for the same unit depending on
// the property, so parse both and return null rather than NaN for "never".
export function parseSystemdStamp(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!s || s === "0" || s === "n/a" || s === "infinity") return null;
  if (/^\d+$/.test(s)) {
    const usec = Number(s);
    if (!Number.isFinite(usec) || usec <= 0) return null;
    return Math.floor(usec / 1000);
  }
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

const TIMER_PROPS = [
  "LoadState",
  "ActiveState",
  "UnitFileState",
  "TimersCalendar",
  "LastTriggerUSec",
  "NextElapseUSecRealtime",
  "Unit",
];

// Result is systemd's verdict on the last run SINCE THE LAST BOOT OR RESET, not
// a historical record: a unit that has not run this boot answers Result=success
// with an empty ExecMainExitTimestamp, which is "no news" wearing the shape of
// good news. Measured on the box 2026-08-27 against postmark-settlement-shadow,
// whose genuinely last run exited 1. So ALARM-failed catches a rail that is
// firing-and-failing NOW; it is not, and cannot be, a history check. The
// heartbeat is what covers the historical question, which is why every row has
// one.
const SERVICE_PROPS = [
  "LoadState",
  "ActiveState",
  "UnitFileState",
  "Result",
  "ExecMainStatus",
  "ExecMainExitTimestamp",
  "ActiveEnterTimestamp",
];

function readUnit(name) {
  const isTimer = name.endsWith(".timer");
  const kv = showProps(name, isTimer ? TIMER_PROPS : SERVICE_PROPS);
  const u = {
    load_state: kv.LoadState || "not-found",
    active_state: kv.ActiveState || "inactive",
    unit_file_state: kv.UnitFileState || "",
  };
  if (isTimer) {
    // RULE 2. The merged, effective calendar — never the .timer file's own text.
    u.calendar = kv.TimersCalendar || "";
    u.last_trigger_ms = parseSystemdStamp(kv.LastTriggerUSec);
    u.next_elapse_ms = parseSystemdStamp(kv.NextElapseUSecRealtime);
    u.triggers = kv.Unit || "";
  } else {
    u.result = kv.Result || "";
    u.exec_main_status = kv.ExecMainStatus || "";
    u.last_exit_ms = parseSystemdStamp(kv.ExecMainExitTimestamp);
    u.active_enter_ms = parseSystemdStamp(kv.ActiveEnterTimestamp);
  }
  return u;
}

function discoverUnits() {
  // RULE 4's scope, and the scoping is deliberate. Every postmark-* TIMER is in
  // scope because a timer is by definition a thing someone decided should run on
  // a clock. Only ENABLED postmark-* services are in scope, because a `static`
  // service is the body a timer triggers — it has no independent existence to
  // roll-call, and listing all of them would double every row for no signal.
  const out = systemctl(["list-unit-files", "postmark*", "--no-pager", "--no-legend", "--plain"]);
  const found = [];
  for (const line of out.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const [name, state] = parts;
    if (name.endsWith(".timer")) found.push(name);
    else if (name.endsWith(".service") && state === "enabled") found.push(name);
  }
  return found.sort();
}

function readFile(path) {
  if (!existsSync(path)) return { exists: false };
  const st = statSync(path);
  let text = null;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    text = null;
  }
  return { exists: true, mtime_ms: st.mtimeMs, size: st.size, text };
}

// ── §3b custody collection ──────────────────────────────────────────────────
//
// WHY THIS EXISTS (2026-08-30, the v1 sweep). On 2026-08-28 a `sudo git` touched
// the settlement clone and left root-owned files inside it. The service runs as
// `meepo`; root-owned refs, objects and a root-owned credential store each fail
// LATER and SEPARATELY — a two-hour pen lockout one day, a refused 05:45Z
// crossing the next — with nothing tying them to the one act that caused them.
// No surface on the box could see the ownership of a working file at all.
//
// It is a scan, so it is BOUNDED and it says when it hit the bound. A scan that
// could not finish is not a clean scan, and reporting one as clean is exactly
// the failure this file exists to end.
export const CUSTODY_SCAN_CAP = 50_000;

/** The numeric uid a name resolves to on this box, or null. */
function uidOf(user) {
  try {
    const out = execFileSync("id", ["-u", String(user)], { encoding: "utf8", timeout: 10_000 }).trim();
    return /^\d+$/.test(out) ? Number(out) : null;
  } catch {
    return null;
  }
}

export function scanCustody(root, expectUid, { cap = CUSTODY_SCAN_CAP, readdir = readdirSync, lstat = lstatSync } = {}) {
  const offenders = [];
  let seen = 0;
  let truncated = false;
  const stack = [root];
  while (stack.length) {
    if (seen >= cap) { truncated = true; break; }
    const path = stack.pop();
    let st;
    try { st = lstat(path); } catch { continue; }
    seen += 1;
    if (expectUid !== null && st.uid !== expectUid) offenders.push({ path, uid: st.uid });
    if (st.isDirectory()) {
      let names = [];
      try { names = readdir(path); } catch { continue; }
      for (const name of names) stack.push(join(path, name));
    }
  }
  return { scanned: seen, truncated, offenders };
}

// ── §3c tree collection ─────────────────────────────────────────────────────
//
// WHY THIS EXISTS (2026-09-10, the arm gate). The 05:45Z crossing published
// green under release/2026-w37.9 and `escrow_projection` held ZERO rows after
// the same timer's clearing, because the candle — postmark-world2-clearing.service
// — runs clearing-job.mjs out of /srv/world2-lab/office, A SECOND OFFICE
// CHECKOUT at 7926461 (2026-09-05, schema <= 012, no escrow ingest) THAT THE
// RELEASE WORKFLOW NEVER DEPLOYS. Four units share that tree through
// deploy/world2-lib.sh's `WORLD2_OFFICE="${WORLD2_OFFICE:-$WORLD2_LAB/office}"`.
//
// EVERY ROW ON THE BOARD READ CORRECTLY AND THE BOARD WAS WRONG. The candle's
// row read OK because it reads the candle's TICK — the lane ran, on time, wrote
// its state file, and did old work. The notary's row read ALARM-outcome because
// the manifest (written from the new tree) declares an outcome log the OLD
// notary has no code to write. Neither row could say the word "tree", so the one
// fact that explained both was the one fact nothing on the box was holding.
//
// So this collects, for every unit the manifest names, THE TREE IT WILL
// ACTUALLY RUN, and the release stamp of that tree beside the deployed one.
//
// ⚑ THE SECRET. `systemctl show <unit> -p Environment` PRINTS THE MERGED
//   ENVIRONMENT, and on this box that includes
//   postmark-settlement.service.d/clearing-url.conf, whose WORLD2_CLEARING_URL
//   carries a Postgres password. The runbook's own rule is "never run
//   `systemctl show postmark-settlement.service -p Environment`", and a
//   collector that stuffed that string into a snapshot would be the same leak
//   with a file attached — `--dump-snapshot` writes to /tmp and the runbook
//   copies it OFF THE BOX. `pickEnv` is therefore a WHITELIST, applied at the
//   moment of reading: only the keys the manifest's tree rows name survive the
//   call, and the raw string is never stored, never returned and never logged.

/** Parse systemd's `Environment=` value and keep ONLY the named keys.
 *
 *  The whitelist is the whole point (see the note above), so this returns a
 *  fresh object holding nothing else — not the raw string, not the other pairs.
 *  systemd quotes any value containing whitespace, so the tokenizer has to
 *  respect quoting or a password with a space in it would split into fragments
 *  and one of the fragments could look like a key. */
export function pickEnv(raw, keys) {
  const want = new Set(keys || []);
  const out = Object.create(null);
  if (typeof raw !== "string" || !raw.length || !want.size) return out;
  let i = 0;
  while (i < raw.length) {
    while (i < raw.length && /\s/.test(raw[i])) i += 1;
    if (i >= raw.length) break;
    let tok = "";
    let quote = null;
    while (i < raw.length) {
      const c = raw[i];
      if (c === "\\" && i + 1 < raw.length) { tok += raw[i + 1]; i += 2; continue; }
      if (quote === null && (c === '"' || c === "'")) { quote = c; i += 1; continue; }
      if (quote !== null && c === quote) { quote = null; i += 1; continue; }
      if (quote === null && /\s/.test(c)) break;
      tok += c; i += 1;
    }
    const eq = tok.indexOf("=");
    if (eq > 0) {
      const k = tok.slice(0, eq);
      if (want.has(k)) out[k] = tok.slice(eq + 1);
    }
  }
  return out;
}

/** The deploy stamp the release workflow ships beside the code it ships. */
export function readRelease(root, { read = readFile } = {}) {
  const path = join(root, "release.json");
  const f = read(path);
  if (!f || !f.exists || typeof f.text !== "string") return { exists: false, root, path };
  try {
    const d = JSON.parse(f.text);
    return { exists: true, root, path, sha: d.sha ? String(d.sha) : "", tag: d.tag ? String(d.tag) : "", deployed_at: d.deployed_at ?? null };
  } catch {
    return { exists: false, root, path, unreadable: true };
  }
}

// A hand-copied directory is the same failure class one layer down, and it is
// ALREADY LIVE on this box: DEPLOY.md says of /srv/world2-lab/ops "a plain file
// copy from this repo" and, of a one-line default it had to fix on 2026-09-05,
// "The box's copy of the script is stale until it is carried." Nothing carries
// it, and nothing goes red while it is uncarried. Bounded, and it says so when
// it hits the bound, for scanCustody's reason: a scan that could not finish is
// not a clean scan.
export const COPY_SCAN_CAP = 500;

/** Every file the box's copy holds, compared BYTE FOR BYTE against the release's.
 *  Read as bytes rather than text on purpose — DEPLOY.md's own warning is that a
 *  trailing `\r` from a Windows checkout "fails in a way that reads like a
 *  missing file", and a text compare would call that pair identical. */
export function compareFileCopy(boxDir, releaseDir, matchRe, {
  cap = COPY_SCAN_CAP, readdir = readdirSync, read = readFileSync, exists = existsSync,
} = {}) {
  const base = { box_dir: boxDir, release_dir: releaseDir };
  if (!exists(boxDir)) return { ...base, exists: false };
  if (!exists(releaseDir)) return { ...base, exists: true, release_dir_missing: true, scanned: 0, missing: [], differing: [], truncated: false };
  let names;
  try { names = readdir(boxDir); } catch { return { ...base, exists: true, unreadable: true }; }
  names = names.filter((n) => matchRe.test(n)).sort();
  const missing = [];
  const differing = [];
  let scanned = 0;
  let truncated = false;
  for (const n of names) {
    if (scanned >= cap) { truncated = true; break; }
    scanned += 1;
    const rp = join(releaseDir, n);
    if (!exists(rp)) { missing.push(n); continue; }
    try {
      if (!read(join(boxDir, n)).equals(read(rp))) differing.push(n);
    } catch { differing.push(n); }
  }
  return { ...base, exists: true, scanned, missing, differing, truncated };
}

function safeRealpath(p) {
  try { return realpathSync(p); } catch { return p; }
}

/** The service unit that EXECS for a manifest row — a timer execs nothing. */
export function serviceOf(unitName) {
  return unitName.endsWith(".service") ? unitName : unitName.replace(/\.timer$/, ".service");
}

export function collectTrees(manifest, {
  show = showProps, realpath = safeRealpath, readRel = readRelease, compare = compareFileCopy,
} = {}) {
  const spec = manifest.trees;
  const tree_sources = Object.create(null);
  const tree_realpath = Object.create(null);
  const releases = Object.create(null);
  const file_copies = Object.create(null);
  if (!spec) return { tree_sources, tree_realpath, releases, file_copies };

  const envKeys = [...new Set((spec.rows || []).map((r) => r.env_key).filter(Boolean))];

  // Every manifest unit, not only the rowed ones — the omission check in §5d
  // reads this, and it is what keeps the tree rows from decaying into a snapshot
  // of the day they were written.
  for (const row of manifest.units) {
    const svc = serviceOf(row.unit);
    if (svc in tree_sources) continue;
    const kv = show(svc, ["WorkingDirectory", "Environment"]);
    tree_sources[svc] = { working_directory: kv.WorkingDirectory || "", env: pickEnv(kv.Environment || "", envKeys) };
  }

  const note = (p) => {
    if (!p || p in tree_realpath) return tree_realpath[p] ?? p;
    const real = realpath(p);
    tree_realpath[p] = real;
    if (!(real in releases)) releases[real] = readRel(real);
    return real;
  };

  const releaseReal = note(spec.release_root);
  for (const row of spec.rows || []) {
    if (row.kind === "file_copy") {
      const boxDir = row.path;
      const releaseDir = join(releaseReal, row.from);
      file_copies[row.id] = compare(boxDir, releaseDir, new RegExp(row.match || "."));
      continue;
    }
    const declared = declaredTree(row, { tree_sources }, spec);
    if (declared.tree) note(declared.tree);
    if (row.must_be !== "release") note(row.must_be);
  }

  return { tree_sources, tree_realpath, releases, file_copies };
}

export function collect(manifest, { now = Date.now() } = {}) {
  const units = Object.create(null);
  const services = Object.create(null);
  const files = Object.create(null);
  const custody = Object.create(null);

  const discovered = discoverUnits();
  const wanted = new Set([...discovered, ...manifest.units.map((r) => r.unit)]);

  for (const name of wanted) {
    const u = readUnit(name);
    if (name.endsWith(".timer")) {
      units[name] = u;
      // The timer's own health says nothing about whether the work SUCCEEDED.
      // Read the service it triggers too — Result=exit-code with a fresh trigger
      // is a rail that is firing perfectly and failing every time.
      const svc = u.triggers || name.replace(/\.timer$/, ".service");
      if (svc && !services[svc]) services[svc] = readUnit(svc);
    } else {
      services[name] = u;
    }
  }

  for (const row of manifest.units) {
    const hb = row.heartbeat;
    if (hb && hb.kind === "state_file" && hb.path) files[hb.path] = readFile(hb.path);
    // §9's input: the rolling receipt log, read like any other state file. A
    // single receipt answers "what did the LAST crossing do"; only the log can
    // answer "has it published anything in three days".
    if (row.outcome && row.outcome.history_path) files[row.outcome.history_path] = readFile(row.outcome.history_path);
  }

  for (const row of manifest.custody ?? []) {
    if (!existsSync(row.path)) { custody[row.id] = { exists: false, path: row.path }; continue; }
    const expectUid = uidOf(row.must_be_owned_by);
    custody[row.id] = {
      exists: true,
      path: row.path,
      must_be_owned_by: row.must_be_owned_by,
      expect_uid: expectUid,
      ...scanCustody(row.path, expectUid),
    };
  }

  return {
    schema: 1,
    collected_at: new Date(now).toISOString(),
    host: process.env.HOSTNAME || "",
    discovered,
    units,
    services,
    files,
    custody,
    ...collectTrees(manifest),
  };
}

// ── §4 heartbeat reading ────────────────────────────────────────────────────
//
// Two kinds, and the difference matters. `unit_trigger` asks systemd when the
// timer last fired — available for every timer, and it proves the CLOCK ran.
// `state_file` asks the work's own output when it was last written — stronger,
// because it proves the work reached its end and produced something.
//
// Within `state_file`, `stamp_field` is stronger still than mtime: a file that
// was touched, copied, or rewritten with the same old content has a fresh mtime
// and a stale stamp, and the stamp is the one that is about the WORK. Prefer it
// wherever the file carries one; the shadow's verdict carries "at" and that is
// precisely the number that would have shown it rotting.

export function readStampField(text, field) {
  if (typeof text !== "string" || !text.trim()) return null;
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  const raw = doc && typeof doc === "object" ? doc[field] : undefined;
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "number") return raw > 1e11 ? raw : raw * 1000;
  const ms = Date.parse(String(raw));
  return Number.isFinite(ms) ? ms : null;
}

export function heartbeatOf(row, snapshot) {
  const hb = row.heartbeat || {};
  if (hb.kind === "unit_active") {
    // A daemon has no cadence to be late for: its liveness IS that it is up, and
    // that is checked above this by the active_state branch. The beat it reports
    // is when it last came up, so the operator can see a flap (an office that
    // "came up 4 min ago" every morning is a crash loop wearing a green tick).
    const u = snapshot.units[row.unit] || snapshot.services[row.unit];
    const ms = u ? u.active_enter_ms ?? null : null;
    return { found: !!u && (u.active_state === "active" || u.active_state === "activating"), at_ms: ms, source: `${row.unit} uptime`, timeless: true };
  }
  if (hb.kind === "unit_trigger") {
    const u = snapshot.units[row.unit];
    const ms = u ? u.last_trigger_ms ?? null : null;
    return { found: ms !== null, at_ms: ms, source: `systemd's last trigger of ${row.unit}` };
  }
  if (hb.kind === "state_file") {
    const f = snapshot.files[hb.path];
    if (!f || !f.exists) return { found: false, at_ms: null, source: hb.path, missing_file: true };
    if (hb.stamp_field) {
      const ms = readStampField(f.text, hb.stamp_field);
      if (ms === null) {
        return { found: false, at_ms: null, source: `${hb.path} (${hb.stamp_field})`, unreadable_stamp: true };
      }
      return { found: true, at_ms: ms, source: `${hb.path} (${hb.stamp_field})` };
    }
    return { found: true, at_ms: f.mtime_ms ?? null, source: `${hb.path} (mtime)` };
  }
  return { found: false, at_ms: null, source: "", no_kind: true };
}

export function humanUptime(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "for an unknown time";
  const abs = Math.max(0, ms);
  if (abs < MINUTE) return "less than a minute";
  const mins = Math.round(abs / MINUTE);
  if (mins < 90) return `${mins} min`;
  const hours = abs / HOUR;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)} days`;
}

export function humanAge(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "never";
  const abs = Math.max(0, ms);
  if (abs < MINUTE) return "just now";
  const mins = Math.round(abs / MINUTE);
  if (mins < 90) return `${mins} min ago`;
  const hours = abs / HOUR;
  if (hours < 48) return `${hours.toFixed(1)}h ago`;
  return `${(hours / 24).toFixed(1)} days ago`;
}

// ── §5 the judgment (pure) ──────────────────────────────────────────────────

function unitIsPresent(u) {
  return !!u && u.load_state !== "not-found" && u.load_state !== "";
}

function unitIsEnabled(u) {
  // "static" is enabled-by-nature: it has no [Install] section because something
  // else pulls it in. Only a timer is ever expected to carry enabled/disabled.
  return !!u && (u.unit_file_state === "enabled" || u.unit_file_state === "static" || u.unit_file_state === "enabled-runtime");
}

export function classifyRow(row, snapshot, now) {
  const u = snapshot.units[row.unit] || snapshot.services[row.unit];
  const label = row.label || row.unit;

  // ── parked rows. Reported forever, alarmed on only when the box disagrees
  // with the manifest about whether the rail is inert.
  if (row.stage === "parked") {
    if (unitIsPresent(u) && (unitIsEnabled(u) || u.active_state === "active" || u.active_state === "activating")) {
      return {
        unit: row.unit,
        label,
        verdict: ALARM_UNPARKED,
        reason:
          `${label} is recorded PARKED in the manifest but the box has it ` +
          `${u.unit_file_state || u.active_state} — either it was adopted and the roll-call was not told, ` +
          `or it was enabled by accident. Adoption owner: ${row.activation_owner}`,
      };
    }
    return {
      unit: row.unit,
      label,
      verdict: PARKED,
      reason: `${label} is parked by design — ${row.parked_because || "not adopted"} (adopt: ${row.adopt_command || "see DEPLOY.md"})`,
    };
  }

  // ── RULE 1: the unit is judged before the heartbeat, always.
  if (!unitIsPresent(u)) {
    return {
      unit: row.unit,
      label,
      verdict: ALARM_MISSING,
      reason:
        `${label} is in the roll-call and NOT ON THE BOX (systemd says load-state ` +
        `${u ? u.load_state : "absent"}). Nothing is running it. Activation owner: ${row.activation_owner}`,
    };
  }

  // ── RULE 3: an un-allowanced heartbeat is unwatchable. Caught before anything
  // that would try to use the allowance, so the defect names itself.
  const hb = row.heartbeat || {};
  const allowance = row.heartbeat && row.heartbeat.stale_after_minutes;
  if (!hb.kind) {
    return {
      unit: row.unit,
      label,
      verdict: ALARM_UNBOUNDED,
      reason: `${label} declares no heartbeat at all — the roll-call cannot tell whether it is doing its work`,
    };
  }
  // A row may go without an allowance ONLY by writing down why. That escape
  // hatch is deliberately a SENTENCE and not a flag: an always-on daemon really
  // has no cadence to be late for, but "this one doesn't need it" is also what a
  // lazily-written row would say, and the difference between the two is exactly
  // the sentence. Forcing it to be typed puts the claim where a reviewer can
  // disagree with it.
  const exempt = typeof row.no_staleness_because === "string" && row.no_staleness_because.trim().length > 0;
  if (!exempt && (!Number.isFinite(allowance) || allowance <= 0)) {
    return {
      unit: row.unit,
      label,
      verdict: ALARM_UNBOUNDED,
      reason:
        `${label} names a heartbeat (${hb.path || hb.kind}) with no stale_after_minutes and no ` +
        `no_staleness_because — nothing can ever call it old, which is exactly how the settlement ` +
        `shadow's would-refuse verdict went unread for more than two days`,
    };
  }

  if (row.unit.endsWith(".timer") && !unitIsEnabled(u)) {
    return {
      unit: row.unit,
      label,
      verdict: ALARM_DISABLED,
      reason:
        `${label} is installed but ${u.unit_file_state || "not enabled"} (${u.active_state}) — ` +
        `it will not fire again. Activation owner: ${row.activation_owner}`,
    };
  }
  if (!row.unit.endsWith(".timer") && u.active_state !== "active" && u.active_state !== "activating") {
    return {
      unit: row.unit,
      label,
      verdict: ALARM_DISABLED,
      reason: `${label} is installed but ${u.active_state} — the daemon is not up. Activation owner: ${row.activation_owner}`,
    };
  }

  // The service behind the timer. A timer that fires flawlessly into a service
  // that exits non-zero every time is the most cheerful-looking outage there is.
  const svcName = (u.triggers && u.triggers.trim()) || row.unit.replace(/\.timer$/, ".service");
  const svc = snapshot.services[svcName];
  if (row.unit.endsWith(".timer") && svc && svc.result && svc.result !== "success") {
    return {
      unit: row.unit,
      label,
      verdict: ALARM_FAILED,
      reason:
        `${label} last RAN and FAILED — ${svcName} result=${svc.result}` +
        (svc.exec_main_status ? ` exit=${svc.exec_main_status}` : "") +
        `. The clock is fine; the work is not (journalctl -u ${svcName})`,
    };
  }

  const beat = heartbeatOf(row, snapshot);
  if (!beat.found) {
    const why = beat.missing_file
      ? "its state file does not exist"
      : beat.unreadable_stamp
        ? `its state file carries no readable ${hb.stamp_field}`
        : "systemd has no record of it ever firing";
    return {
      unit: row.unit,
      label,
      verdict: ALARM_NOHEARTBEAT,
      reason: `${label} is enabled but ${why} (${beat.source}) — it has produced no evidence of running`,
    };
  }

  const age = beat.at_ms === null ? null : now - beat.at_ms;
  if (beat.timeless || exempt) {
    // Deliberately terse. The justification sentence lives in the manifest where
    // a reviewer reads it once; repeating a paragraph on a green line every
    // morning is how a board teaches its reader to skim.
    return {
      unit: row.unit,
      label,
      verdict: OK,
      reason: `${label} has been up ${humanUptime(age)} (${row.cadence})`,
    };
  }
  if (age > allowance * MINUTE) {
    return {
      unit: row.unit,
      label,
      verdict: ALARM_STALE,
      reason:
        `${label} last ran ${humanAge(age)} — allowance is ${allowance} min (${row.cadence}). ` +
        `${row.stale_means || ""}`.trim() + ` [${beat.source}]`,
    };
  }

  // ── §9: THE RAIL RAN. WHAT CAME OUT OF IT. ───────────────────────────────
  // Judged last, and that ordering is the point: staleness says the work did
  // not happen, and this says it happened and was wrong. A stale row must not
  // be relabelled by its own stale contents.
  const outcome = judgeOutcome(row, snapshot);
  // The count line rides on BOTH verdicts below — beside an alarm it is the
  // context on the finding, beside a green tick it is the whole of what the
  // rail had to say — and on neither is it a verdict (postmark#2935).
  const counts = outcomeCounts(row, snapshot);
  const tail = counts ? ` · ${counts}` : "";
  if (outcome) {
    return { unit: row.unit, label, verdict: ALARM_OUTCOME, reason: `${label} ${outcome}${tail}` };
  }

  return {
    unit: row.unit,
    label,
    verdict: OK,
    reason: `${label} ticked ${humanAge(age)} (${row.cadence}) [${beat.source}]${tail}`,
  };
}

// ── §5b judging a rail by its OUTPUT ────────────────────────────────────────
//
// WHY (2026-08-30, the v1 sweep). The settlement row judged timer recency and
// nothing else, so on 2026-08-31 the board would have read a green tick over a
// crossing that had refused identically at 02:39Z with `"phase":"unknown"` — the
// clock was perfect and the town settled nothing. The same blindness had already
// been named one layer up: "on 2026-08-26 a crossing left 42 marks drafted and
// reported nothing; a starving crossing printed '0 published, 0 unpublished' and
// read as a quiet day for two days."
//
// TWO SHAPES, because they fail differently. A TERMINAL CLASS is loud and
// instantaneous — one canon-bad refusal is already forever, since no rerun can
// clear it. STARVATION is quiet and only visible across crossings: each receipt
// is individually honest and the pattern is the finding, which is exactly what a
// file overwritten twice a day cannot hold.
//
// Every threshold is manifest data. A baseline compiled into this file is a
// number nobody can review beside the reason for it.

/** The parsed history rows for a row's outcome block, oldest first. */
export function outcomeHistory(row, snapshot) {
  const path = row.outcome && row.outcome.history_path;
  if (!path) return [];
  const f = (snapshot.files || {})[path];
  if (!f || !f.exists || typeof f.text !== "string") return [];
  // The log's own reader, on the text the snapshot already holds. The roll-call
  // never opens this file itself — deploy/box-rollcall.sh reads it on the box
  // and hands it over — so this is `readHistory(text)`, not `readHistory(path)`.
  return readHistory(f.text);
}

/** The sentence to alarm with, or null when the output is fine. */
export function judgeOutcome(row, snapshot) {
  const spec = row.outcome;
  if (!spec) return null;
  const history = outcomeHistory(row, snapshot);
  // `means` is the sentence the operator reads at 8am and `why` is the paragraph
  // a reviewer reads once, in the manifest, beside the thresholds it argues for.
  // Printing the paragraph on the board every morning is how a board teaches its
  // reader to skim — the same mistake as an alarm with no reason, from the other
  // side.
  const means = spec.means ? ` ${spec.means}` : "";

  if (!history.length) {
    // Declared and empty. Reported rather than shrugged at: a row that says it
    // is judged by its output and has no output is a row nobody is judging.
    return `declares an outcome log at ${spec.history_path} and it is empty or unreadable — nothing here is judging what the rail produces.${means}`;
  }

  const latest = history[history.length - 1];
  const terminal = new Set(spec.alarm_on_classes || []);
  if (latest.class && terminal.has(latest.class)) {
    return `last ran and REFUSED with class ${latest.class} at ${latest.at} — a class no rerun clears, so every crossing from here composes the same answer until the record is repaired.${means}`;
  }

  // A REFUSAL THAT KEEPS COMING BACK. The class alarm above catches the one
  // that announces itself as terminal; this catches the one that does not and
  // is terminal anyway. The receipt is postmark-world 7f866059 (2026-08-30
  // 22:40), whose own message says the fault "was the sweep's standing 2-error
  // lint refusal (EVERY CROSSING SINCE 08-28 re-drained them, dropped one,
  // tripped on the other)" — six input-bad refusals over three days, each one
  // individually rerunnable and none of them ever cleared, because the thing
  // producing them was upstream of the rerun. Judged on STATUS rather than on
  // left_drafted, because a refused crossing never gets far enough to have
  // channel counts at all: its receipt carries zeros, so the starvation rule
  // below cannot see it.
  //
  // AND IT IS THE SCHEDULE THE QUESTION IS ABOUT (postmark#2979, 2026-09-21).
  // The judgement is `recurringUnsettled` — the same function the crossing's own
  // 05:45Z escalation calls — so the board and the escalation cannot answer
  // differently about one log. It filters rather than skips: a by-hand line
  // between two refusals must not shorten the evidence, and a run of by-hand
  // probes is not the timer refusing. The window below is derived the same way
  // for the SENTENCE, because the judgement returns a verdict, not its rows.
  const stuck = Number(spec.unsettled_runs);
  if (recurringUnsettled(history, stuck)) {
    const window = scheduledRuns(history).slice(-stuck);
    const classes = [...new Set(window.map((r) => r.class).filter(Boolean))];
    return (
      `has not completed a crossing in its last ${stuck} attempts — ${window.map((r) => r.status).join(", ")}` +
      `${classes.length ? ` (class ${classes.join(", ")})` : ""}. A refusal that keeps returning is terminal ` +
      `whatever its class says: whatever produces it is upstream of the rerun.${means}`
    );
  }

  // THE SAME GAP FROM THE OTHER SIDE (postmark#2979). A by-hand publication is
  // still a published crossing, so one of them anywhere in the window made
  // `noneOut` false and the starvation alarm went quiet while the TIMER
  // published nothing and left_drafted climbed. Judged on the scheduled lines,
  // and the length gate counts them too: fewer than `runs` scheduled crossings
  // is not yet evidence about the schedule, the same way its sibling above is
  // deliberately false on a short history.
  const runs = Number(spec.zero_published_runs);
  const scheduled = scheduledRuns(history);
  if (Number.isFinite(runs) && runs > 0 && scheduled.length >= runs) {
    const window = scheduled.slice(-runs);
    const noneOut = window.every((r) => Number(r.published || 0) === 0);
    const backedUp = Number(window[window.length - 1].left_drafted || 0) > Number(window[0].left_drafted || 0);
    if (noneOut && backedUp) {
      return (
        `has published nothing across its last ${runs} crossings while left_drafted grew ` +
        `${window[0].left_drafted} -> ${window[window.length - 1].left_drafted} — work is arriving and none is ` +
        `getting out. Every one of those receipts is individually honest; the pattern is the finding.${means}`
      );
    }
  }

  // THE STEP THAT IS NOT RUNNING AT ALL (G1 lane 1, 2026-09-08).
  //
  // The retire step tells the store what the world unpublished. It degrades
  // LOUDLY BY DESIGN — a box with no `WORLD2_CLEARING_URL` writes a named
  // absence into every receipt rather than failing the crossing — and that is
  // the right failure and exactly the shape nobody reads. A named absence
  // repeated twice a day forever is indistinguishable from a quiet town unless
  // something is counting, which is the `left_drafted` lesson one rule up.
  //
  // NULL AND ZERO ARE DIFFERENT FACTS AND ONLY ONE OF THEM ALARMS.
  // deploy/settlement-history.mjs writes `retired: <n>` when the step ran and
  // `retired: null` when it did not. A crossing that ran and retired nothing is
  // a normal, common, green crossing — most are. A crossing that never asked is
  // the register drifting from canon with nothing saying so. Alarming on `0`
  // would fire on almost every crossing and teach the board to be ignored.
  //
  // A MISSING FIELD IS NOT A NULL. History lines written before this field
  // existed have no `retired` key at all, and `undefined` deliberately does not
  // match: an old log must not alarm about a step that did not exist when it was
  // written. The rule therefore judges only crossings that ran the code that
  // reports it, and it starts judging on its own as soon as they do — no
  // install-day exception needed, unlike its sibling above.
  //
  // IT CARRIES ITS OWN `means`, AND THAT IS THE POINT OF THE SEPARATE FIELD.
  // The shared `spec.means` above ends with an INSTALL-DAY NOTE — "this row is
  // EXPECTED to read ALARM-outcome until the first crossing after deploy writes
  // the log, and it clears itself then" — which is true of its siblings and
  // FALSE here: a missing `retired` key does not match, so this rule is silent
  // on an old log and has no install day to be excused for. Appending the
  // shared sentence would have handed the operator an excuse for the one alarm
  // that never needs one, which is how a real finding gets read as expected
  // noise. `retire_means` names the box carry instead.
  const blind = Number(spec.retire_null_runs);
  if (Number.isFinite(blind) && blind > 0 && history.length >= blind) {
    const window = history.slice(-blind);
    if (window.every((r) => Object.prototype.hasOwnProperty.call(r, "retired") && r.retired === null)) {
      const mine = spec.retire_means ? ` ${spec.retire_means}` : means;
      return (
        `has crossed ${blind} times without the store hearing what the world unpublished — every one of those ` +
        `receipts carries \`retired: {ran: false}\`. The world let marks go and the register still stands them, ` +
        `which is the disagreement standing-equality reddens on. The usual cause is that ` +
        `\`WORLD2_CLEARING_URL\` is absent from the settlement unit's environment, so the step names its own ` +
        `absence and retires nothing.${mine}`
      );
    }
  }

  // THE LIST THAT MUST BE EMPTY (postmark#2594, ruled 2026-09-08).
  //
  // `falsifier-canon-locks.mjs` appends one line per crossing naming every
  // locked claim the world carries no file for. The class it watches went
  // unseen for three weeks because NOTHING WAS LOOKING — not because anything
  // was quiet about it — so the alarm is the list itself, not a trend across
  // runs: one name in it is a disagreement between the two records standing
  // right now, and by the time it repeats it has already been true for twelve
  // hours.
  //
  // JUDGED ON THE LATEST LINE ONLY, and that is the difference from every rule
  // above. `left_drafted` and `retired` are about a rail's BEHAVIOUR over time,
  // where one bad crossing is noise; this is about the STORE'S STATE, where the
  // most recent reading is the only one that is still true.
  //
  // A LATEST LINE CARRYING NONE OF THE NAMED FIELDS IS ITSELF THE ALARM, and it
  // is deliberately not the `retired` rule's silent-on-a-missing-key shape. That
  // discipline is right for a field a rail grew into; it is wrong here, because
  // "silent when the field is absent" means a writer that stops emitting the list
  // turns its own alarm off. The judge says so instead.
  // IT CARRIES ITS OWN `means`, FOR THE REASON `retire_means` DOES ONE RULE UP
  // AND FOR A SHARPER ONE. The shared `spec.means` ends with an INSTALL-DAY NOTE
  // — "this row is EXPECTED to read ALARM-outcome until the first crossing after
  // deploy appends to the log, and it clears itself then" — which is true of the
  // empty-log case above and FALSE here: a line naming a slug is never install-day
  // noise. Appending it would hand the operator a ready-made excuse for the one
  // alarm that has no excuse, which is how a real finding gets skimmed past. I
  // wrote it the other way first and the end-to-end run on the box showed the
  // excuse attached to `lupi/the-drift-room`; this is that repair.
  // THE LIST RULE AND THE FLAG RULE BOTH SPEAK (lap 5, the lap-4 reviewer's
  // LOW). Until this lap the judge returned the FIRST rule's sentence, so while
  // `canon_absent` carried a slug — prod's condition since window 177,
  // `lupi/the-drift-room` — the list alarm returned and `unchecked_means` never
  // printed: the operator was told about lupi and NOT told that the escrow half
  // of the read has never run. Repair 2 closed the day lupi settles; this closes
  // the days before it, which are the days between merge and that settlement.
  // The board's reason is one string that already carries a paragraph of
  // `means`, so two sentences fit; the list sentence stays FIRST — the finding,
  // then the caveat on it. The class-terminal and stuck rules above still return
  // alone: they describe a rail that did not produce a line worth judging, and
  // there is nothing for a second sentence to be about.
  const sentences = [];

  const lists = Array.isArray(spec.alarm_on_nonempty) ? spec.alarm_on_nonempty : [];
  if (lists.length) {
    const mine = spec.list_means ? ` ${spec.list_means}` : "";
    const present = lists.filter((f) => Object.prototype.hasOwnProperty.call(latest, f));
    const found = present
      .map((f) => ({ field: f, items: Array.isArray(latest[f]) ? latest[f] : [] }))
      .filter((r) => r.items.length);
    if (!present.length) {
      sentences.push(`declares an alarm on ${lists.join(", ")} and its latest line at ${latest.at ?? "?"} carries none of them — ` +
        `the instrument and this judge disagree about the shape, so nothing is being judged.${mine}`);
    } else if (found.length) {
      const n = found.reduce((t, r) => t + r.items.length, 0);
      sentences.push(`last read at ${latest.at ?? "?"} found ${found.map((r) => `${r.items.length} ${r.field}`).join(" and ")} — ` +
        `${found.map((r) => r.items.join(", ")).join(" · ")}. ` +
        `The store and canon disagree about ${n === 1 ? "a mark that stands" : "marks that stand"} in the register today.${mine}`);
    }
  }

  // A FIELD PRESENT AND FALSE IS ALSO AN ALARM (the reviewer's repair 2,
  // 2026-09-08). The sibling rule above catches a latest line carrying NONE of
  // the named fields. This catches the other shape: the field is there, the
  // instrument is honest, and it says it did not check.
  //
  // THE HOLE IT CLOSES, driven through this judge against the real manifest row:
  //
  //   canon absent carries lupi, escrow unchecked   → ALARM (on the canon half;
  //                                                   since lap 5 on BOTH — below)
  //   canon empty, escrow list empty, UNCHECKED     → OK        ← the hole
  //   canon empty, escrow list empty, checked       → OK
  //   escrow list carries a slug, checked           → ALARM
  //
  // Rows two and three were the same verdict for opposite facts. Masked only
  // because the canon half still carried a slug; the moment that settled, the row
  // would have gone green while the escrow gate — the lane's centre and the G1
  // blocker — had never once been checked.
  //
  // It is the lane's own rule applied everywhere except the alarm:
  // `escrow-presence.mjs` says a store that cannot answer and a town where nobody
  // staked are different facts, and `world2-notary.sh` says "ran and found
  // nothing" and "did not run" must not look alike. Both were true of the read
  // and neither was true of the judge.
  //
  // ITS OWN `means`, for the same reason `list_means` has one: this alarm has a
  // known, named, pending cause (the migration), and printing the list-alarm's
  // sentence would tell an operator to go looking for a stake that is not the
  // problem.
  const flags = Array.isArray(spec.alarm_on_false) ? spec.alarm_on_false : [];
  if (flags.length) {
    const said = flags.filter((f) => Object.prototype.hasOwnProperty.call(latest, f) && latest[f] === false);
    const absent = flags.filter((f) => !Object.prototype.hasOwnProperty.call(latest, f));
    if (said.length) {
      // "whatever the list above says of escrow": beside a list finding this
      // sentence is the caveat on it, and beside an empty list it is the whole
      // verdict — one wording that is true in both seats.
      sentences.push(`last read at ${latest.at ?? "?"} reports ${said.join(", ")} — the check did not run, so whatever the list ` +
        `above says of it is a question unanswered and not an answer.${spec.unchecked_means ? ` ${spec.unchecked_means}` : ""}`);
    } else if (absent.length === flags.length) {
      sentences.push(`declares an alarm on ${flags.join(", ")} being false and its latest line at ${latest.at ?? "?"} carries ` +
        `none of them — the instrument and this judge disagree about the shape, so nothing is being judged.` +
        `${spec.unchecked_means ? ` ${spec.unchecked_means}` : ""}`);
    }
  }

  return sentences.length ? sentences.join(" ") : null;
}

/**
 * THE COUNT THAT IS NOT AN ALARM (postmark#2935).
 *
 * `report_counts` names number fields on the latest line that the board PRINTS
 * beside the row's verdict and never alarms on. The case it exists for: the
 * notary's escrow read judges each commons mark at the town sha of the window
 * that locked it, and the projection holds no rows for any window before 181 —
 * so 227 marks locked at windows 150–179 read ESCROW-ABSENT every morning for
 * eight nights, while the number of true unbacked marks was zero. An alarm that
 * is always on teaches its reader to skim, which is the failure `list_means`'s
 * own paragraph names. Those marks are UNJUDGEABLE, not ✦0 (the doorstep's
 * rule): a count, with its one sentence, on the same line as the verdict.
 *
 * A field that is not a number on the latest line is said so, in words, and is
 * still not an alarm: a writer that stops emitting a count loses a count line,
 * not a verdict — the alarms above keep their own "carries none of them" rule
 * for the lists, whose absence IS the alarm. `null` is the read's own word for
 * "the projection was not checked, so nothing was counted", which is not zero.
 *
 * Returns the line, or null when the row declares no counts or has no history
 * (the empty-log alarm in `judgeOutcome` already speaks to that).
 */
export function outcomeCounts(row, snapshot) {
  const spec = row.outcome;
  const fields = spec && Array.isArray(spec.report_counts) ? spec.report_counts : [];
  if (!fields.length) return null;
  const history = outcomeHistory(row, snapshot);
  if (!history.length) return null;
  const latest = history[history.length - 1];
  const parts = fields.map((f) =>
    (typeof latest[f] === "number" && Number.isFinite(latest[f]))
      ? `${latest[f]} ${f}`
      : `${f} not counted on the latest line`);
  return `${parts.join(", ")} — ${spec.count_means}`;
}

// ── §5c judging custody ─────────────────────────────────────────────────────

export function classifyCustody(row, snapshot) {
  const seen = (snapshot.custody || {})[row.id];
  const label = row.label || row.id;
  const unit = `custody:${row.id}`;

  if (!seen || !seen.exists) {
    return {
      unit,
      label,
      verdict: ALARM_CUSTODY,
      reason: `${label} — ${row.path} is not on the box at all, so nothing can be said about who owns it. ${row.why}`,
    };
  }
  if (seen.expect_uid === null || seen.expect_uid === undefined) {
    return {
      unit,
      label,
      verdict: ALARM_CUSTODY,
      reason:
        `${label} — the user ${row.must_be_owned_by} does not resolve to a uid on this box, so the check ` +
        `cannot run and must not report clean. ${row.why}`,
    };
  }
  if (seen.truncated) {
    return {
      unit,
      label,
      verdict: ALARM_CUSTODY,
      reason:
        `${label} — the ownership scan of ${row.path} hit its ${CUSTODY_SCAN_CAP}-entry bound after ` +
        `${seen.scanned} entries and did not finish. A scan that could not finish is not a clean scan. ${row.why}`,
    };
  }
  if (seen.offenders && seen.offenders.length) {
    const named = seen.offenders.slice(0, 5).map((o) => `${o.path} (uid ${o.uid})`);
    const more = seen.offenders.length > named.length ? ` …and ${seen.offenders.length - named.length} more` : "";
    return {
      unit,
      label,
      verdict: ALARM_CUSTODY,
      reason:
        `${label} — ${seen.offenders.length} path(s) under ${row.path} are NOT owned by ${row.must_be_owned_by}: ` +
        `${named.join(", ")}${more}. ${row.why} Repair: ${row.repair || `sudo chown -R ${row.must_be_owned_by} ${row.path}`}`,
    };
  }
  return {
    unit,
    label,
    verdict: OK,
    reason: `${label} — all ${seen.scanned} path${seen.scanned === 1 ? "" : "s"} under ${row.path} ${seen.scanned === 1 ? "is" : "are"} owned by ${row.must_be_owned_by}`,
  };
}

// ── §5d judging THE TREE A UNIT WILL RUN ────────────────────────────────────
//
// Pure, like every other judgment here, and derived from `tree_sources` rather
// than from anything the collector decided — so a falsifier that repoints one
// unit's environment moves exactly one row, which is the whole test idiom of
// this file.

/** Which tree this row's unit will run, and where that answer came from. */
export function declaredTree(row, snapshot, spec) {
  const src = (snapshot.tree_sources || {})[row.unit] || { working_directory: "", env: {} };
  if (row.env_key) {
    const v = (src.env || {})[row.env_key];
    if (v) return { tree: v, source: `${row.env_key} in the unit's environment` };
  }
  if (src.working_directory) return { tree: src.working_directory, source: "the unit's WorkingDirectory" };
  if (row.default_when_unset) {
    return {
      tree: row.default_when_unset,
      source: row.env_key
        ? `nothing sets ${row.env_key}, so ${row.default_source || "the ops lib's default"} decides`
        : row.default_source || "the ops lib's default",
      by_default: true,
    };
  }
  return { tree: "", source: "" };
}

export function classifyTree(row, manifest, snapshot) {
  const spec = manifest.trees;
  const label = row.label || row.id;
  const unit = `tree:${row.kind === "file_copy" ? row.id : row.unit}`;
  const real = (p) => (snapshot.tree_realpath || {})[p] ?? p;
  const releaseRoot = real(spec.release_root);
  const deployed = (snapshot.releases || {})[releaseRoot] || { exists: false };

  // A row whose rail the manifest has parked is not running anything, so there
  // is no tree to be wrong. Reported forever, like every parked row here — the
  // unit row's own ALARM-unparked is what catches a parked rail that came alive.
  const gov = row.kind === "file_copy" ? null : unitRowGoverning(manifest, row.unit);
  if (gov && gov.stage === "parked") {
    return { unit, label, verdict: PARKED, reason: `${label} is parked with ${gov.unit} — nothing is running this tree (adoption owner: ${gov.activation_owner})` };
  }

  // THE DEPLOYED STAMP IS THE YARDSTICK, so an unreadable one is an alarm and
  // never a pass. Judged before anything else for the reason RULE 1 is: a check
  // that cannot read its own reference must say so rather than report clean.
  if (!deployed.exists) {
    return {
      unit, label, verdict: ALARM_TREE,
      reason:
        `${label} cannot be judged — the deployed release stamp at ${releaseRoot}/release.json is ` +
        `${deployed.unreadable ? "unreadable" : "not on the box"}, so nothing here can say which tree is the right one. ` +
        `${row.why} Activation owner: ${row.activation_owner}`,
    };
  }
  const shipped = `${deployed.tag || "?"} @ ${String(deployed.sha || "?").slice(0, 12)}`;

  if (row.kind === "file_copy") {
    const c = (snapshot.file_copies || {})[row.id];
    const where = `${row.path} against ${releaseRoot}/${row.from}`;
    if (!c || !c.exists) {
      return { unit, label, verdict: ALARM_TREE, reason: `${label} — ${row.path} is not on the box at all, so nothing can be said about whether its copies match the release ${shipped}. ${row.why} Activation owner: ${row.activation_owner}` };
    }
    if (c.unreadable || c.release_dir_missing) {
      return { unit, label, verdict: ALARM_TREE, reason: `${label} — ${where} could not be compared (${c.release_dir_missing ? "the release carries no such directory" : "the box directory is unreadable"}). A comparison that could not run is not a clean comparison. ${row.why} Activation owner: ${row.activation_owner}` };
    }
    if (c.truncated) {
      return { unit, label, verdict: ALARM_TREE, reason: `${label} — the comparison of ${where} hit its ${COPY_SCAN_CAP}-file bound after ${c.scanned} files and did not finish. A scan that could not finish is not a clean scan. ${row.why} Activation owner: ${row.activation_owner}` };
    }
    const bad = [...c.differing.map((n) => `${n} (differs)`), ...c.missing.map((n) => `${n} (not in the release)`)];
    if (bad.length) {
      return {
        unit, label, verdict: ALARM_TREE,
        reason:
          `${label} — ${bad.length} of ${c.scanned} file(s) under ${row.path} are NOT the release ${shipped}: ${bad.slice(0, 6).join(", ")}` +
          `${bad.length > 6 ? ` …and ${bad.length - 6} more` : ""}. The units exec these copies, so the box is running code no deploy shipped. ` +
          `${row.why} Repair: ${row.repair || `carry them from ${releaseRoot}/${row.from}`}`,
      };
    }
    return { unit, label, verdict: OK, reason: `${label} — all ${c.scanned} file(s) under ${row.path} are byte-identical to the release ${shipped}` };
  }

  const d = declaredTree(row, snapshot, spec);

  // THE ROW MAY REFUSE TO GUESS, AND THE WORLD2 ROWS DO. Their tree comes from
  // WORLD2_OFFICE, whose fallback lives in `/srv/world2-lab/ops/world2-lib.sh`
  // — a HAND FILE COPY that no deploy updates (DEPLOY.md § Where things live:
  // "a plain file copy from this repo"). So the roll-call cannot read that
  // default, only assume it, and an assumed default is how this class hid: the
  // repo said one path and the box ran another. A row carrying `require_env`
  // says the environment must ANSWER, and an unset key is the alarm rather than
  // an occasion to guess.
  if (!d.tree && row.env_key && row.require_env) {
    return {
      unit, label, verdict: ALARM_TREE,
      reason:
        `${label} — nothing in ${row.unit}'s environment sets ${row.env_key}, so the tree it runs is whatever ` +
        `the box's own copy of the ops lib falls back to, and that copy is not deployed by anything. Install ` +
        `${row.require_env} and daemon-reload. Until then this unit's code is unknowable, which is not the same ` +
        `as correct. ${row.why} Activation owner: ${row.activation_owner}`,
    };
  }
  if (!d.tree) {
    return {
      unit, label, verdict: ALARM_TREE,
      reason:
        `${label} names no tree at all — ${row.unit} carries no WorkingDirectory` +
        `${row.env_key ? `, nothing sets ${row.env_key},` : ""} and the row declares no default, so the roll-call ` +
        `cannot say what code this unit runs. ${row.why} Activation owner: ${row.activation_owner}`,
    };
  }
  const resolved = real(d.tree);

  // A tree that is deliberately NOT the release. Legal, and it costs a sentence
  // in the manifest — see loadManifest's `divergence_because` clause.
  if (row.must_be !== "release") {
    const allowed = real(row.must_be);
    if (resolved === allowed) {
      return { unit, label, verdict: OK, reason: `${label} runs from ${d.tree} (${d.source}), which is the tree this row allows — ${row.divergence_because}` };
    }
    return {
      unit, label, verdict: ALARM_TREE,
      reason:
        `${label} runs from ${d.tree} (${d.source}), which is neither the release ${shipped} at ${releaseRoot} nor ` +
        `the ${row.must_be} this row allows. ${row.why} Activation owner: ${row.activation_owner}`,
    };
  }

  if (resolved === releaseRoot) {
    return { unit, label, verdict: OK, reason: `${label} runs from ${d.tree} (${d.source}) — the deployed release ${shipped}` };
  }

  // Not the same path. It may still be the same CODE: a second copy carrying the
  // same release stamp is a copy the deploy is keeping up with, and reddening on
  // it would be reddening on tidiness rather than on drift.
  const there = (snapshot.releases || {})[resolved] || { exists: false };
  if (there.exists && there.sha && deployed.sha && there.sha === deployed.sha) {
    return { unit, label, verdict: OK, reason: `${label} runs from ${d.tree} (${d.source}) — a separate tree, carrying the same release ${shipped}` };
  }
  const carries = there.exists
    ? `it carries ${there.tag || "?"} @ ${String(there.sha || "?").slice(0, 12)}`
    : there.unreadable
      ? `its release.json is unreadable`
      : `it carries NO release stamp at all — nothing has ever deployed it`;
  return {
    unit, label, verdict: ALARM_TREE,
    reason:
      `${label} runs from ${d.tree} (${d.source}), which is NOT the deployed release ${shipped} at ${releaseRoot} — ` +
      `${carries}. The unit ticks and its work runs OLD CODE. ${row.why} Activation owner: ${row.activation_owner}`,
  };
}

/** RULE 4 for trees. A unit that names a tree and has no row naming it back. */
export function unrowedTrees(manifest, snapshot) {
  const spec = manifest.trees;
  if (!spec) return [];
  const rowed = new Set((spec.rows || []).filter((r) => r.kind !== "file_copy").map((r) => r.unit));
  const envKeys = [...new Set((spec.rows || []).map((r) => r.env_key).filter(Boolean))];
  const out = [];
  for (const row of manifest.units) {
    if (row.stage === "parked") continue;
    const svc = serviceOf(row.unit);
    if (rowed.has(svc)) continue;
    const src = (snapshot.tree_sources || {})[svc];
    if (!src) continue;
    const named = src.working_directory || envKeys.map((k) => (src.env || {})[k]).find(Boolean);
    if (!named) continue;
    out.push({
      unit: `tree:${svc}`,
      label: svc,
      verdict: ALARM_TREE,
      reason:
        `${svc} runs from ${named} and appears in NO tree row — nothing is checking that the code this unit ` +
        `executes is the code the release deployed, which is exactly how the candle ran a three-day-old checkout ` +
        `through a green board on 2026-09-10. Add its row to deploy/box-rollcall-manifest.json § trees`,
    });
  }
  return out;
}

export function rollcall(manifest, snapshot, now = Date.now()) {
  const rows = manifest.units.map((row) => classifyRow(row, snapshot, now));
  for (const row of manifest.custody ?? []) rows.push(classifyCustody(row, snapshot));
  for (const row of manifest.trees?.rows ?? []) rows.push(classifyTree(row, manifest, snapshot));
  rows.push(...unrowedTrees(manifest, snapshot));

  // RULE 4, the other direction. Anything the box carries that the manifest does
  // not name. Without this the roll-call silently becomes a snapshot of the day
  // it was written.
  const named = new Set(manifest.units.map((r) => r.unit));
  for (const found of snapshot.discovered || []) {
    if (named.has(found)) continue;
    rows.push({
      unit: found,
      label: found,
      verdict: ALARM_UNMANIFESTED,
      reason:
        `${found} is installed on the box and appears in NO roll-call row — ` +
        `nobody has said who owns it, what its cadence is, or when it would be stale. ` +
        `Add it to deploy/box-rollcall-manifest.json (parked rows are legal; omission is not)`,
    });
  }

  const counts = { OK: 0, PARKED: 0, ALARM: 0 };
  for (const r of rows) {
    if (isAlarm(r.verdict)) counts.ALARM += 1;
    else if (r.verdict === PARKED) counts.PARKED += 1;
    else counts.OK += 1;
  }

  return { rows, counts, exitCode: counts.ALARM > 0 ? 1 : 0, at: new Date(now).toISOString() };
}

// ── §6 output ───────────────────────────────────────────────────────────────

export function formatLines(result) {
  const out = [];
  // Alarms first and unconditionally. The parked and green rows are printed too —
  // a parked rail must be VISIBLE FOREVER or parking becomes forgetting — but the
  // reader's eye must land on the alarms without scrolling.
  const alarms = result.rows.filter((r) => isAlarm(r.verdict));
  const rest = result.rows.filter((r) => !isAlarm(r.verdict));
  for (const r of [...alarms, ...rest]) out.push(`${r.verdict.padEnd(19)} ${r.unit.padEnd(34)} ${r.reason}`);
  out.push("");
  out.push(
    result.counts.ALARM > 0
      ? `${result.counts.ALARM} ALARM · ${result.counts.OK} ok · ${result.counts.PARKED} parked by design (${result.at})`
      : `roll-call clean — ${result.counts.OK} running, ${result.counts.PARKED} parked by design (${result.at})`,
  );
  return out;
}

// ── §7 CLI ──────────────────────────────────────────────────────────────────

function argOf(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

export function run() {
  const manifestPath = resolve(argOf("manifest", DEFAULT_MANIFEST));
  let manifest;
  try {
    manifest = loadManifest(manifestPath);
  } catch (err) {
    console.error(`[box-rollcall] the roll-call itself could not run: ${err.message}`);
    return 2;
  }

  const snapshotPath = argOf("snapshot");
  const dumpPath = argOf("dump-snapshot");
  const now = Date.now();

  let snapshot;
  if (snapshotPath) {
    try {
      snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
    } catch (err) {
      console.error(`[box-rollcall] unreadable snapshot ${snapshotPath}: ${err.message}`);
      return 2;
    }
  } else {
    try {
      snapshot = collect(manifest, { now });
    } catch (err) {
      console.error(`[box-rollcall] could not read the box: ${err.message}`);
      console.error(`[box-rollcall] this tool runs ON the box (it shells to systemctl).`);
      return 2;
    }
  }

  // --dump-snapshot saves the reading AND still judges it. It deliberately does
  // NOT get its own early return: a flag that made this tool exit 0 without
  // judging is an instrument that returns the shape of a good answer, and the
  // first time somebody wired that flag into the round the board would read
  // clean forever.
  if (dumpPath) {
    writeFileSync(dumpPath, JSON.stringify(snapshot, null, 1));
    console.error(`[box-rollcall] snapshot written to ${dumpPath}`);
  }

  const result = rollcall(manifest, snapshot, now);
  if (process.argv.includes("--json")) console.log(JSON.stringify(result, null, 1));
  else for (const line of formatLines(result)) console.log(line);
  return result.exitCode;
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
if (isMain) process.exit(run());
