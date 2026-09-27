// Falsifiers for box-rollcall.
//
// The law these assert is the founder's acceptance criterion of 2026-08-27,
// quoted verbatim wherever a test claims an alarm must fire:
//
//     "A box roll-call exists: a manifest of every unit that must run with its
//      expected heartbeat, a checker that emits ALARM for missing or stale,
//      wired into my daily operator round — and on install day it must find the
//      unread shadow-script verdict, proving it can fail. OPERATIONS.md carries
//      the law: a mechanism folds only with its runner, its liveness check, and
//      its activation owner named. 'Built' is not 'done.'"
//
// ── HOW THE FIXTURE IS BUILT, AND WHY IT IS BUILT THAT WAY ──────────────────
//
// Every test below starts from `healthy()`, which PLANTS THE HEALTHY STATE: a
// snapshot in which every live row's unit is loaded, enabled, active and ticking
// at half its allowance, every state file exists with a fresh stamp, every
// service behind a timer reports success, and every parked row's unit is honestly
// absent from the box. The first test asserts that fixture is entirely green and
// exits 0. That control is not a formality — without it, a mutation test proves
// only that the row is red, never that the MUTATION made it red, and a fixture
// that was already broken would let every falsifier below pass for the wrong
// reason.
//
// The fixture is GENERATED FROM THE SHIPPED MANIFEST rather than hand-written
// per unit. A hand-written fixture goes stale the first time somebody adds a row
// — the new unit would simply not appear in it, and every test here would keep
// passing while saying nothing at all about the new rail. Generating it means a
// manifest row that cannot be made healthy is itself a test failure.
//
// Each mutation asserts, before anything else, that it CHANGED SOMETHING. That
// check is here because of a lane in this repo where two flips reported "the
// edit changed nothing" and the reason turned out to be invisible NUL bytes in
// the source. A mutation that silently no-ops is a falsifier that proves the
// guard works when in fact the guard was never reached.

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname, delimiter } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadManifest,
  rollcall,
  classifyRow,
  outcomeCounts,
  heartbeatOf,
  readStampField,
  parseSystemdStamp,
  formatLines,
  isAlarm,
  humanAge,
  DEFAULT_MANIFEST,
  OK,
  PARKED,
  ALARM_MISSING,
  ALARM_UNBOUNDED,
  ALARM_DISABLED,
  ALARM_FAILED,
  ALARM_NOHEARTBEAT,
  ALARM_STALE,
  ALARM_UNPARKED,
  ALARM_UNMANIFESTED,
  ALARM_OUTCOME,
  ALARM_CUSTODY,
  ALARM_TREE,
  scanCustody,
  judgeOutcome,
  classifyTree,
  declaredTree,
  unrowedTrees,
  serviceOf,
  pickEnv,
  readRelease,
  compareFileCopy,
  collectTrees,
  COPY_SCAN_CAP,
  MINUTE,
} from "../tools/box-rollcall.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(HERE, "..", "deploy", "box-rollcall-manifest.json");

const T0 = Date.parse("2026-08-27T06:00:00Z");

// The release the box was carrying when the tree class was found — the stamp
// release-train.yml wrote for release/2026-w37.9, under which the 2026-09-10
// 05:45Z crossing published green while the candle ran 7926461.
const DEPLOYED_TAG = "release/2026-w37.9";
const DEPLOYED_SHA = "b01b3bad946dfb14f5479e9b677e17dad59ebbbe";
// The retired second checkout, and the commit it was stuck at.
const LAB_TREE = "/srv/world2-lab/office";
const LAB_SHA = "7926461a0000000000000000000000000000feed";

function manifest() {
  return loadManifest(MANIFEST_PATH);
}

// A manifest with a parked row PLANTED, used by every test about the PARKED
// verdict.
//
// ── WHY THIS EXISTS (2026-08-30, the v1 sweep) ──────────────────────────────
// These tests used to reach into the shipped manifest for a row that happened
// to be parked, and postmark-stripe-watch was the one they found. It was ADOPTED
// on 2026-08-27 — correctly, by the founder's word — and three tests here went
// red at once, THE CONTROL among them, for a manifest that had become more true
// rather than less. A control that reddens when the town changes lawfully is a
// control nobody can read, and while it stands red every falsifier under it
// proves nothing.
//
// Whether the town is carrying a parked rail on any given day is a fact about
// the town. That PARKED is a verdict, is printed, is counted apart from OK, and
// alarms when the box disagrees, is a property of THIS CHECKER — so it is
// asserted against a row this file plants and owns.
const PLANTED_PARKED_UNIT = "postmark-example-parked.timer";

function parkedManifest(m = manifest()) {
  return {
    ...m,
    units: [
      ...m.units,
      {
        unit: PLANTED_PARKED_UNIT,
        label: "a rail built and deliberately not adopted",
        stage: "parked",
        activation_owner: "planted by test/box-rollcall.test.mjs — this row is not on the box and never will be",
        cadence: "would be hourly once adopted",
        cadence_source: "systemctl show — once it exists",
        parked_because: "built, reviewed, and not yet wanted; the founder has not called the manual path tedious",
        adopt_command: "sudo systemctl enable --now postmark-example-parked.timer",
        heartbeat: { kind: "state_file", path: "/srv/postmark-example/state.json", stamp_field: "last_run", stale_after_minutes: 90 },
        stale_means: "nothing, while parked — a parked row is never alarmed for being inert",
      },
    ],
  };
}

// The healthy state, planted. Everything green, by construction, at T0.
function healthy(m = manifest()) {
  const units = {};
  const services = {};
  const files = {};
  const discovered = [];

  for (const row of m.units) {
    const hb = row.heartbeat || {};
    // Half the allowance: comfortably fresh, and far enough from the boundary
    // that a test which pushes a stamp past it cannot be a rounding accident.
    const halfway = Number.isFinite(hb.stale_after_minutes) ? (hb.stale_after_minutes / 2) * MINUTE : 60 * MINUTE;
    const beatAt = T0 - halfway;

    if (row.stage === "parked") {
      // A parked unit is honestly ABSENT from the box — which is what "parked"
      // means on postmark-stripe-watch today: never installed, by design.
      units[row.unit] = { load_state: "not-found", active_state: "inactive", unit_file_state: "" };
      if (hb.kind === "state_file" && hb.path) files[hb.path] = { exists: false };
      continue;
    }

    discovered.push(row.unit);

    if (row.unit.endsWith(".timer")) {
      const svcName = row.unit.replace(/\.timer$/, ".service");
      units[row.unit] = {
        load_state: "loaded",
        active_state: "active",
        unit_file_state: "enabled",
        calendar: `OnCalendar=${row.cadence}`,
        last_trigger_ms: beatAt,
        next_elapse_ms: T0 + halfway,
        triggers: svcName,
      };
      services[svcName] = {
        load_state: "loaded",
        active_state: "inactive",
        unit_file_state: "static",
        result: "success",
        exec_main_status: "0",
        last_exit_ms: beatAt,
      };
    } else {
      services[row.unit] = {
        load_state: "loaded",
        active_state: "active",
        unit_file_state: "enabled",
        result: "success",
        exec_main_status: "0",
        active_enter_ms: T0 - 3 * 24 * 60 * MINUTE,
      };
    }

    if (hb.kind === "state_file" && hb.path) {
      const doc = hb.stamp_field ? { [hb.stamp_field]: new Date(beatAt).toISOString() } : {};
      files[hb.path] = { exists: true, mtime_ms: beatAt, text: JSON.stringify(doc, null, 1) };
    }

    // §9: a row judged by its OUTPUT gets a healthy log planted — crossings that
    // published, with the backlog going down rather than up. Generated from the
    // row's own thresholds so a manifest that raises `zero_published_runs` gets
    // a longer healthy window without anyone remembering to widen it here.
    if (row.outcome && row.outcome.history_path) {
      const n = Math.max(Number(row.outcome.zero_published_runs) || 3, 3) + 2;
      const lines = [];
      for (let i = n - 1; i >= 0; i--) {
        lines.push(JSON.stringify({
          at: new Date(beatAt - i * 12 * 60 * MINUTE).toISOString(),
          status: "published", class: null,
          published: 4, left_drafted: 20 + i, quarantined: 0,
          // The retire step RAN and had nothing to retire — the common green
          // crossing. `0` must never alarm; only `null` (nobody asked) does.
          retired: 0,
          world_from: "aaaa", world_to: "bbbb",
          // A row that declares a list-alarm gets the fields it declares, EMPTY —
          // the healthy shape for `canon_absent` is "the read ran and found
          // nothing", which is most crossings. Generated from the row's own
          // declaration rather than hard-coded, for the same reason the window
          // length is: a manifest that names a third list must not go green here
          // because nobody remembered to widen a fixture.
          ...Object.fromEntries((row.outcome.alarm_on_nonempty ?? []).map((f) => [f, []])),
          // …and a row that declares a present-and-false alarm gets the flag
          // TRUE, which is its healthy shape: the check RAN. Generated from the
          // row's own declaration for the same reason as the lists above — a
          // manifest that names a second flag must not go green here because
          // nobody remembered to widen a fixture.
          ...Object.fromEntries((row.outcome.alarm_on_false ?? []).map((f) => [f, true])),
          // …and a row that declares a COUNT gets a number, which is its only
          // healthy shape: a count is printed, never judged (postmark#2935).
          ...Object.fromEntries((row.outcome.report_counts ?? []).map((f) => [f, 0])),
        }));
      }
      files[row.outcome.history_path] = { exists: true, mtime_ms: beatAt, text: `${lines.join("\n")}\n` };
    }
  }

  // §2b: custody clean by construction — the path exists, the user resolves, the
  // scan finished, nobody else owns anything.
  const custody = {};
  for (const row of m.custody ?? []) {
    custody[row.id] = {
      exists: true, path: row.path, must_be_owned_by: row.must_be_owned_by,
      expect_uid: 1001, scanned: 412, truncated: false, offenders: [],
    };
  }

  // §2c: every tree row healthy by construction — each unit running the tree its
  // row says it must, and the deployed stamp readable. Generated from the shipped
  // manifest for the reason everything else here is: a tree row somebody adds
  // must not go green because nobody remembered to widen a fixture.
  const tree_sources = {};
  const tree_realpath = {};
  const releases = {};
  const file_copies = {};
  const spec = m.trees;
  if (spec) {
    releases[spec.release_root] = {
      exists: true, root: spec.release_root, path: `${spec.release_root}/release.json`,
      sha: DEPLOYED_SHA, tag: DEPLOYED_TAG, deployed_at: new Date(T0).toISOString(),
    };
    for (const row of m.units) {
      const svc = serviceOf(row.unit);
      if (!(svc in tree_sources)) tree_sources[svc] = { working_directory: "", env: {} };
    }
    for (const row of spec.rows ?? []) {
      if (row.kind === "file_copy") {
        file_copies[row.id] = {
          exists: true, box_dir: row.path, release_dir: `${spec.release_root}/${row.from}`,
          scanned: 9, missing: [], differing: [], truncated: false,
        };
        continue;
      }
      const tree = row.must_be === "release" ? spec.release_root : row.must_be;
      // A row that declares an env_key gets an ENVIRONMENT that answers, never a
      // planted default: those rows carry `require_env` precisely because the
      // default is unreadable from here, and a fixture that supplied one would
      // be proving the opposite of what the row says.
      if (row.env_key) tree_sources[row.unit].env[row.env_key] = tree;
      else tree_sources[row.unit].working_directory = tree;
    }
  }

  return { schema: 1, collected_at: new Date(T0).toISOString(), host: "meepo-ec2", discovered, units, services, files, custody, tree_sources, tree_realpath, releases, file_copies };
}

// Deep-equality guard. A mutation that changes nothing is a falsifier that never
// reached the code it claims to falsify.
function mutate(before, fn) {
  const after = JSON.parse(JSON.stringify(before));
  fn(after);
  assert.notDeepEqual(after, before, "the mutation changed nothing — the falsifier below would prove nothing");
  return after;
}

function rowFor(result, unit) {
  const r = result.rows.find((x) => x.unit === unit);
  assert.ok(r, `no row for ${unit}`);
  return r;
}

// ── §0 THE CONTROL ──────────────────────────────────────────────────────────

test("THE CONTROL: the planted healthy state is entirely green and exits 0", () => {
  const m = manifest();
  const result = rollcall(m, healthy(m), T0);

  const bad = result.rows.filter((r) => isAlarm(r.verdict));
  assert.deepEqual(
    bad.map((r) => `${r.verdict} ${r.unit}`),
    [],
    "the fixture itself is not healthy — every falsifier below would pass for the wrong reason",
  );
  assert.equal(result.exitCode, 0);
  assert.equal(result.counts.ALARM, 0);

  // Every row accounted for, and every parked row still VISIBLE. "a
  // built-but-parked rail must be visible forever" is the whole reason PARKED is
  // a verdict rather than an omission. Whether the SHIPPED manifest carries a
  // parked row today is a fact about the town, not about this checker, so the
  // PARKED path itself is proven below over a row this file plants.
  assert.equal(result.rows.length, m.units.length + (m.custody ?? []).length + (m.trees?.rows ?? []).length);
  assert.ok((m.custody ?? []).length > 0, "the manifest declares no custody row — §2b is not being run at all");
  assert.ok((m.trees?.rows ?? []).length > 0, "the manifest declares no tree row — §2c is not being run at all");
  for (const p of m.units.filter((u) => u.stage === "parked")) {
    assert.equal(rowFor(result, p.unit).verdict, PARKED);
  }

  // The planted-parked manifest must be green too, or the three PARKED tests
  // below would each be measuring a fixture that was already broken.
  const planted = parkedManifest(m);
  const withParked = rollcall(planted, healthy(planted), T0);
  assert.deepEqual(withParked.rows.filter((r) => isAlarm(r.verdict)).map((r) => `${r.verdict} ${r.unit}`), []);
  assert.equal(rowFor(withParked, PLANTED_PARKED_UNIT).verdict, PARKED);
});

// ── §1 FALSIFIER (a): a manifest unit absent from the live list ─────────────

test("FALSIFIER (a): a manifest unit that is NOT ON THE BOX is ALARM-missing, and the run exits nonzero", () => {
  // "a checker that emits ALARM for missing or stale"
  const m = manifest();
  const base = healthy(m);

  // The world-drain shape: something we swore would run, with no runner at all.
  const broken = mutate(base, (s) => {
    s.units["postmark-ferry.timer"] = { load_state: "not-found", active_state: "inactive", unit_file_state: "" };
    s.discovered = s.discovered.filter((u) => u !== "postmark-ferry.timer");
  });

  const result = rollcall(m, broken, T0);
  const row = rowFor(result, "postmark-ferry.timer");
  assert.equal(row.verdict, ALARM_MISSING);
  assert.match(row.reason, /NOT ON THE BOX/);

  // The law's third clause — "its activation owner named" — has to survive into
  // the alarm line, or the operator reading it at 8am does not know whose call
  // it was to run this and cannot tell an oversight from a decision.
  assert.match(row.reason, /Activation owner:/);
  assert.ok(row.reason.length > 80, "the alarm names an owner but says nothing about who");

  assert.equal(result.exitCode, 1);
  // …and exactly one row went red. A falsifier that reddens the whole board
  // proves the board can be red, not that this branch works.
  assert.equal(result.counts.ALARM, 1);
});

// ── §2 FALSIFIER (b): a state file older than its allowance ─────────────────

test("FALSIFIER (b): a state file older than its allowance is ALARM-stale, and one minute inside it is not", () => {
  // "a checker that emits ALARM for missing or stale"
  const m = manifest();
  const base = healthy(m);
  const row = m.units.find((u) => u.unit === "postmark-site-sentinel.timer");
  const allowance = row.heartbeat.stale_after_minutes;
  const path = row.heartbeat.path;

  const stale = mutate(base, (s) => {
    const at = new Date(T0 - (allowance + 5) * MINUTE).toISOString();
    s.files[path] = { exists: true, mtime_ms: T0 - (allowance + 5) * MINUTE, text: JSON.stringify({ generated_at: at }) };
  });
  const red = rollcall(m, stale, T0);
  const sentinel = rowFor(red, "postmark-site-sentinel.timer");
  assert.equal(sentinel.verdict, ALARM_STALE);
  assert.match(sentinel.reason, /allowance is 30 min/);
  assert.equal(red.exitCode, 1);

  // THE DISCRIMINATING CASE, and the reason this test is two halves. An
  // "is it stale" assertion that only ever tests a very old file passes just as
  // happily against a checker that calls EVERYTHING stale. The boundary is where
  // the two possible implementations disagree.
  const fresh = mutate(base, (s) => {
    const at = new Date(T0 - (allowance - 1) * MINUTE).toISOString();
    s.files[path] = { exists: true, mtime_ms: T0 - (allowance - 1) * MINUTE, text: JSON.stringify({ generated_at: at }) };
  });
  const green = rollcall(m, fresh, T0);
  assert.equal(rowFor(green, "postmark-site-sentinel.timer").verdict, OK);
  assert.equal(green.exitCode, 0);
});

test("FALSIFIER (b2): the stamp INSIDE the file beats its mtime — a touched file is not a fresh run", () => {
  // The stamp field exists because a state file rewritten with unchanged content,
  // copied, or merely touched has a fresh mtime and did no work. mtime answers
  // "when did the bytes move"; the stamp answers "when did the WORK happen", and
  // only the second one is the liveness question.
  const m = manifest();
  const row = m.units.find((u) => u.unit === "postmark-settlement.timer");
  const path = row.heartbeat.path;

  const touched = mutate(healthy(m), (s) => {
    s.files[path] = {
      exists: true,
      mtime_ms: T0 - MINUTE, // touched one minute ago …
      text: JSON.stringify({ at: "2026-08-20T05:45:00Z" }), // … and last DECIDED a week back
    };
  });

  const result = rollcall(m, touched, T0);
  const settlement = rowFor(result, "postmark-settlement.timer");
  assert.equal(settlement.verdict, ALARM_STALE, "a one-minute-old mtime hid a seven-day-old verdict");
  assert.match(settlement.reason, /days ago/);
});

// ── §3 FALSIFIER (c): THE SHADOW CASE ───────────────────────────────────────

test("FALSIFIER (c): a verdict file with no stale_after is ALARM-unbounded — it can never be called old", () => {
  // "on install day it must find the unread shadow-script verdict, proving it can
  // fail." The shadow's verdict carried no field saying when it went off, so
  // nothing on the box or in either repo could ever have said it was stale — and
  // it was served, unread, for more than two days. A row that declares no
  // allowance reproduces exactly that blindness, so it must alarm rather than
  // quietly pass forever.
  const m = manifest();
  const shadow = m.units.find((u) => u.unit === "postmark-settlement-shadow.timer");
  assert.ok(shadow, "the shipped manifest does not carry the settlement shadow at all");

  const base = healthy(m);
  const lazyManifest = JSON.parse(JSON.stringify(m));
  const lazyRow = lazyManifest.units.find((u) => u.unit === "postmark-settlement-shadow.timer");
  delete lazyRow.heartbeat.stale_after_minutes;

  // Serve it genuinely stale at the same time — the real 08-24 verdict, verbatim
  // from the box. If the checker leaned on the allowance it would now read
  // `undefined` and compare its way to a cheerful pass.
  const served = mutate(base, (s) => {
    s.files[shadow.heartbeat.path] = {
      exists: true,
      mtime_ms: Date.parse("2026-08-24T22:27:00Z"),
      text: JSON.stringify({
        at: "2026-08-24T22:23:00Z",
        status: "would-refuse",
        town_sha: "baa87242071e05b66748d53e25060c833352641b",
        world_main: "d549239901d7f23bda201682099a4b6aa3ef30e3",
        detail: "grammar suite would go red",
      }),
    };
  });

  const result = rollcall(lazyManifest, served, T0);
  const row = rowFor(result, "postmark-settlement-shadow.timer");
  assert.equal(row.verdict, ALARM_UNBOUNDED);
  assert.match(row.reason, /no stale_after_minutes/);
  assert.equal(result.exitCode, 1);

  // THE CONTROL FOR THIS ONE. The same lazily-written row, with the file FRESH,
  // must still alarm — otherwise the check is just a slow way of detecting
  // staleness and the unbounded class survives untouched whenever the rail
  // happens to be healthy on the morning somebody looks.
  const fresh = mutate(base, (s) => {
    s.files[shadow.heartbeat.path] = {
      exists: true,
      mtime_ms: T0 - MINUTE,
      text: JSON.stringify({ at: new Date(T0 - MINUTE).toISOString(), status: "would-settle" }),
    };
  });
  assert.equal(rowFor(rollcall(lazyManifest, fresh, T0), "postmark-settlement-shadow.timer").verdict, ALARM_UNBOUNDED);
});

test("FALSIFIER (c2): the escape from an allowance is a written SENTENCE, and an empty one does not count", () => {
  // A daemon genuinely has no cadence to be late for, so an exemption has to
  // exist. It is deliberately a sentence rather than a flag: "this one doesn't
  // need it" is also what a lazily-written row would say, and the difference
  // between a real exemption and a lazy one IS the sentence.
  const m = manifest();
  const base = healthy(m);

  const office = m.units.find((u) => u.unit === "postmark-office.service");
  assert.ok(office.no_staleness_because && office.no_staleness_because.length > 40, "the office row's exemption is not a sentence");
  assert.equal(rowFor(rollcall(m, base, T0), "postmark-office.service").verdict, OK);

  for (const empty of ["", "   ", null]) {
    const stripped = JSON.parse(JSON.stringify(m));
    stripped.units.find((u) => u.unit === "postmark-office.service").no_staleness_because = empty;
    const row = rowFor(rollcall(stripped, base, T0), "postmark-office.service");
    assert.equal(row.verdict, ALARM_UNBOUNDED, `an exemption of ${JSON.stringify(empty)} was accepted as a justification`);
  }
});

// ── §4 THE ORDER OF JUDGMENT: the unit before the heartbeat ────────────────

test("FALSIFIER (d): a DISABLED timer alarms even with a perfectly fresh heartbeat — the hand-run trap", () => {
  // Measured on the box 2026-08-27: /srv/postmark-office/.stripe-watch-state.json
  // read four minutes fresh while postmark-stripe-watch.timer did not exist on
  // the machine at all — a hand-run wrote it. A checker that ranked freshness
  // first would call a rail with no runner healthy on the strength of a file a
  // human touched. So the unit is judged BEFORE the heartbeat, always.
  const m = manifest();
  const broken = mutate(healthy(m), (s) => {
    s.units["postmark-settlement-shadow.timer"].unit_file_state = "disabled";
    s.units["postmark-settlement-shadow.timer"].active_state = "inactive";
    // …and the heartbeat left AS FRESH AS THE FIXTURE PLANTED IT. This is the
    // whole point: nothing about the file changed.
  });

  const result = rollcall(m, broken, T0);
  const row = rowFor(result, "postmark-settlement-shadow.timer");
  assert.equal(row.verdict, ALARM_DISABLED, "a fresh file was allowed to speak for a dead unit");
  assert.match(row.reason, /will not fire again/);
  assert.equal(result.exitCode, 1);
  assert.equal(result.counts.ALARM, 1);
});

test("FALSIFIER (e): a timer firing on time into a service that FAILS is ALARM-failed", () => {
  // The most cheerful-looking outage there is: the clock is perfect, the work
  // exits non-zero every time, and the timer's own status is spotless.
  const m = manifest();
  const broken = mutate(healthy(m), (s) => {
    s.services["postmark-harbor-watch.service"].result = "exit-code";
    s.services["postmark-harbor-watch.service"].exec_main_status = "1";
  });

  const row = rowFor(rollcall(m, broken, T0), "postmark-harbor-watch.timer");
  assert.equal(row.verdict, ALARM_FAILED);
  assert.match(row.reason, /result=exit-code/);
  assert.match(row.reason, /journalctl -u postmark-harbor-watch\.service/);
});

test("FALSIFIER (f): a state file that does not exist is ALARM-noheartbeat, not ALARM-stale", () => {
  // These are different findings and want different hands: stale means it ran
  // and stopped, absent means it may never have run at all. Collapsing them
  // sends the operator looking for a run that was never there.
  const m = manifest();
  const row = m.units.find((u) => u.unit === "postmark-usdc-watch.timer");
  const broken = mutate(healthy(m), (s) => {
    s.files[row.heartbeat.path] = { exists: false };
  });
  const verdict = rowFor(rollcall(m, broken, T0), "postmark-usdc-watch.timer");
  assert.equal(verdict.verdict, ALARM_NOHEARTBEAT);
  assert.match(verdict.reason, /state file does not exist/);
});

test("FALSIFIER (f2): a file that exists but carries no readable stamp must NOT fall through to its mtime", () => {
  // Split out from (f) deliberately. The two share a verdict but not a branch,
  // and when they lived in one test a flip that made the unreadable-stamp path
  // fall back to mtime still left the test red for the OTHER half's reason —
  // which would have let a real regression hide behind a passing sibling
  // assertion. A falsifier that cannot tell which branch broke is measuring the
  // test file, not the code.
  //
  // The failure this guards: a truncated, half-written, or 500-page state file
  // has bytes as fresh as a successful run's. mtime would call it healthy.
  const m = manifest();
  const row = m.units.find((u) => u.unit === "postmark-usdc-watch.timer");
  const garbled = mutate(healthy(m), (s) => {
    s.files[row.heartbeat.path] = { exists: true, mtime_ms: T0, text: "not json at all" };
  });
  const verdict = rowFor(rollcall(m, garbled, T0), "postmark-usdc-watch.timer");
  assert.equal(verdict.verdict, ALARM_NOHEARTBEAT);
  assert.match(verdict.reason, /carries no readable last_run/);

  // A valid JSON document that simply lacks the field is the same finding — this
  // is the shape a schema change produces, and it is the one most likely to
  // arrive quietly.
  const renamed = mutate(healthy(m), (s) => {
    s.files[row.heartbeat.path] = { exists: true, mtime_ms: T0, text: JSON.stringify({ ran_at: new Date(T0).toISOString() }) };
  });
  assert.equal(rowFor(rollcall(m, renamed, T0), "postmark-usdc-watch.timer").verdict, ALARM_NOHEARTBEAT);
});

// ── §5 PARKED: visible forever, and honest in both directions ──────────────

test("FALSIFIER (g): a PARKED row that the box has ENABLED is ALARM-unparked", () => {
  // "Include entries for units that are deliberately parked (stage: parked) so
  // the checker names them PARKED rather than omitting them — a built-but-parked
  // rail must be visible forever."
  //
  // The other half of that, which the mandate implies and this asserts: parked
  // must not become a place to hide. If someone adopts Stage B and nobody
  // updates the roll-call, the manifest and the box now disagree about whether a
  // rail that WRITES to the ledger is inert — and a checker that shrugged at
  // that would be underwriting the exact silence it exists to end.
  //
  // Which is exactly what happened to postmark-stripe-watch on 2026-08-27: it
  // WAS adopted, the manifest's stage word was flipped, and the sentences
  // around it went on describing a rail that is not on the box. This asserts
  // the checker's half of that, over a planted row, so it keeps asserting it
  // after the town's own parked rails come and go.
  const m = parkedManifest();
  const adopted = mutate(healthy(m), (s) => {
    s.units[PLANTED_PARKED_UNIT] = {
      load_state: "loaded",
      active_state: "active",
      unit_file_state: "enabled",
      last_trigger_ms: T0 - 5 * MINUTE,
      triggers: PLANTED_PARKED_UNIT.replace(/\.timer$/, ".service"),
    };
    s.discovered.push(PLANTED_PARKED_UNIT);
  });

  const row = rowFor(rollcall(m, adopted, T0), PLANTED_PARKED_UNIT);
  assert.equal(row.verdict, ALARM_UNPARKED);
  assert.match(row.reason, /recorded PARKED in the manifest but the box has it/);
});

test("a PARKED row is printed, counted apart from OK, and never contributes to the exit code", () => {
  const m = parkedManifest();
  const result = rollcall(m, healthy(m), T0);
  assert.ok(result.counts.PARKED >= 1);
  assert.equal(result.exitCode, 0);

  const lines = formatLines(result).join("\n");
  assert.match(lines, new RegExp(`PARKED\\s+${PLANTED_PARKED_UNIT.replace(/\./g, "\\.")}`));
  assert.match(lines, /parked by design/);
  // The summary line says the parked count out loud. A board that counts only
  // the green ones and then says "all clear" is how a rail shipped inert and
  // forgotten reads as a clean tick forever.
  assert.match(lines, /parked by design \(/);
});

// ── §6 THE REVERSE DIRECTION ────────────────────────────────────────────────

test("FALSIFIER (h): a unit on the box that NO manifest row names is ALARM-unmanifested", () => {
  // Without this the roll-call decays into a snapshot of the day it was written:
  // every unit installed afterwards is invisible to it, which is precisely the
  // condition the roll-call exists to end.
  const m = manifest();
  const broken = mutate(healthy(m), (s) => {
    s.discovered.push("postmark-economy-report.timer");
    s.units["postmark-economy-report.timer"] = {
      load_state: "loaded",
      active_state: "active",
      unit_file_state: "enabled",
      last_trigger_ms: T0 - MINUTE,
    };
  });

  const result = rollcall(m, broken, T0);
  const row = rowFor(result, "postmark-economy-report.timer");
  assert.equal(row.verdict, ALARM_UNMANIFESTED);
  assert.match(row.reason, /appears in NO roll-call row/);
  assert.match(row.reason, /parked rows are legal; omission is not/);
  assert.equal(result.exitCode, 1);
});

// ── §7 THE MANIFEST'S OWN LAW ───────────────────────────────────────────────

test("the manifest refuses a row with no activation owner — 'a mechanism folds only with … its activation owner named'", () => {
  const m = manifest();
  for (const row of m.units) {
    assert.ok(
      typeof row.activation_owner === "string" && row.activation_owner.length > 20,
      `${row.unit} names no activation owner`,
    );
    assert.ok(typeof row.stale_means === "string" && row.stale_means.length > 20, `${row.unit} does not say what stale means`);
  }

  // And the loader is the thing that enforces it, not this test's goodwill —
  // otherwise the rule holds only for rows that existed when it was written.
  const stripped = JSON.parse(JSON.stringify(m));
  delete stripped.units[0].activation_owner;
  const dir = mkdtempSync(join(tmpdir(), "box-rollcall-"));
  const tmp = join(dir, "manifest.json");
  writeFileSync(tmp, JSON.stringify(stripped));
  assert.throws(() => loadManifest(tmp), /names no activation_owner/);

  writeFileSync(tmp, JSON.stringify({ units: [{ unit: "x.timer", stage: "someday", activation_owner: "nobody" }] }));
  assert.throws(() => loadManifest(tmp), /must be "live" or "parked"/);

  writeFileSync(tmp, JSON.stringify({ units: [{ stage: "live", activation_owner: "nobody" }] }));
  assert.throws(() => loadManifest(tmp), /no unit name/);

  writeFileSync(tmp, JSON.stringify({ schema: 1 }));
  assert.throws(() => loadManifest(tmp), /has no units\[\]/);
});

test("the dev-freshen row's cadence came from systemctl, NOT from its .timer file", () => {
  // Measured on the box 2026-08-27. /etc/systemd/system/postmark-dev-freshen.timer
  // says `OnCalendar=*:0/10` and calls itself "every 10 minutes" in its own
  // Description; the drop-in at .timer.d/nightly.conf clears that line and
  // substitutes `OnCalendar=*-*-* 08:10:00 UTC`. The effective cadence is DAILY,
  // and a checker that read the file would be wrong by a factor of 144 in the
  // direction of alarming on a healthy rail every ten minutes forever.
  //
  // This is the sibling of a scar already in this repo: site-sentinel's
  // stripe_watch probe once carried a reason line quoting a cadence the box did
  // not run. The two numbers live in different files and nothing but a test
  // makes them agree.
  const m = manifest();
  const row = m.units.find((u) => u.unit === "postmark-dev-freshen.timer");

  assert.ok(row.heartbeat.stale_after_minutes >= 24 * 60, "the dev-freshen allowance is sized for a ten-minute cadence — it is daily");
  assert.match(row.cadence, /daily/i);
  assert.match(row.cadence_source, /systemctl show/);
  assert.match(row.cadence_source, /drop-in/, "the row does not warn the next reader about the drop-in that overrides the file");

  // Every timer row must source its cadence from systemctl, for the same reason.
  for (const r of m.units.filter((u) => u.unit.endsWith(".timer") && u.stage === "live")) {
    assert.match(r.cadence_source, /systemctl show/, `${r.unit} sources its cadence from something other than systemctl show`);
  }
});

// ── §8 the small parsers, each given the bad case once ─────────────────────

test("parseSystemdStamp reads both shapes systemd prints, and 'never' is null rather than NaN", () => {
  // Both shapes appear on the same box for the same unit depending on the
  // property, and a NaN here would compare false against every threshold — a
  // stale unit that reads as fresh, silently.
  assert.equal(parseSystemdStamp("Wed 2026-08-26 16:30:26 UTC"), Date.parse("2026-08-26T16:30:26Z"));
  assert.equal(parseSystemdStamp("1756276226000000"), 1756276226000);
  for (const never of ["", "0", "n/a", "infinity", null, undefined]) {
    assert.equal(parseSystemdStamp(never), null, `${JSON.stringify(never)} did not read as "never"`);
  }
  assert.equal(parseSystemdStamp("not a date"), null);
});

test("readStampField returns null rather than a guess when the field is absent or the file is not JSON", () => {
  assert.equal(readStampField(JSON.stringify({ at: "2026-08-24T22:23:00Z" }), "at"), Date.parse("2026-08-24T22:23:00Z"));
  assert.equal(readStampField(JSON.stringify({ at: "2026-08-24T22:23:00Z" }), "generated_at"), null);
  assert.equal(readStampField("<html>a 500 page</html>", "at"), null);
  assert.equal(readStampField("", "at"), null);
  // Epoch seconds and epoch millis are both real in this repo's state files.
  assert.equal(readStampField(JSON.stringify({ at: 1756276226 }), "at"), 1756276226000);
  assert.equal(readStampField(JSON.stringify({ at: 1756276226000 }), "at"), 1756276226000);
});

test("humanAge does not round a two-day silence into something that reads like minutes", () => {
  assert.equal(humanAge(30 * 1000), "just now");
  assert.equal(humanAge(25 * MINUTE), "25 min ago");
  assert.equal(humanAge(6 * 60 * MINUTE), "6.0h ago");
  assert.match(humanAge(55.5 * 60 * MINUTE), /2\.3 days ago/);
  assert.equal(humanAge(null), "never");
});

// ── §9 the whole board ──────────────────────────────────────────────────────

test("the printed board puts every ALARM above the green rows, and names the count", () => {
  // The operator reads this at 8am inside a round that already has seven other
  // steps. An alarm below twelve green lines is an alarm nobody reads.
  const m = manifest();
  const broken = mutate(healthy(m), (s) => {
    s.units["postmark-settlement-shadow.timer"].unit_file_state = "disabled";
    s.units["postmark-settlement-shadow.timer"].active_state = "inactive";
  });
  const lines = formatLines(rollcall(m, broken, T0));

  assert.match(lines[0], /^ALARM-disabled\s+postmark-settlement-shadow\.timer/);
  assert.match(lines[lines.length - 1], /^1 ALARM · \d+ ok · \d+ parked by design/);
});

// ── §9 THE RAIL RAN. WHAT CAME OUT OF IT. (v1 #9, 2026-08-30) ───────────────
//
// Every falsifier above asks whether a mechanism MOVED. These are the first that
// read what came out of it, and the law is the night that bought them — the box's
// own journal, postmark-settlement.service:
//
//   Aug 31 02:38:50  Starting postmark-settlement.service …
//   Aug 31 02:39:26  SETTLEMENT-SWEEP-REFUSAL {"cause": … ,"phase":"unknown"}
//   Aug 31 02:39:27  Failed with result 'exit-code'
//
// The timer fired exactly on its mark and the town settled nothing. The row read
// the clock, and the clock was perfect.

const SETTLEMENT = "postmark-settlement.timer";

function historyPathOf(m, unit = SETTLEMENT) {
  const row = m.units.find((u) => u.unit === unit);
  assert.ok(row && row.outcome && row.outcome.history_path, `${unit} declares no outcome log — §9 is not wired to it`);
  return row.outcome.history_path;
}

/** Rewrite a row's outcome log with the given crossings, oldest first. */
function plantHistory(base, m, rows, unit = SETTLEMENT) {
  const path = historyPathOf(m, unit);
  return mutate(base, (s) => {
    s.files[path] = { exists: true, mtime_ms: T0, text: `${rows.map((r) => JSON.stringify(r)).join("\n")}\n` };
  });
}

test("FALSIFIER (i): a crossing that refused canon-bad is ALARM-outcome even with a perfect clock", () => {
  // "canon-bad" is what deploy/settlement-classify.mjs calls a refusal whose
  // failing path is in origin/main's own tree: NO RERUN CAN CLEAR IT, so one
  // occurrence is already forever and every crossing from here composes the same
  // answer. The timer stays flawless throughout, which is the whole point.
  const m = manifest();
  const refused = plantHistory(healthy(m), m, [
    { at: "2026-08-26T17:45:00Z", status: "published", class: null, published: 3, left_drafted: 20 },
    { at: "2026-08-27T05:45:00Z", status: "refused", class: "canon-bad", published: 0, left_drafted: 21 },
  ]);

  const row = rowFor(rollcall(m, refused, T0), SETTLEMENT);
  assert.equal(row.verdict, ALARM_OUTCOME);
  assert.match(row.reason, /REFUSED with class canon-bad/);
  assert.match(row.reason, /no rerun clears/,
    "the alarm does not say that waiting will not help, which is the only thing separating this from an ordinary bad night");
});

test("FALSIFIER (i2): an input-bad refusal does NOT alarm — a rerun genuinely clears it", () => {
  // The 02:39 refusal was this class, and the 02:40 rerun published at 02:59:28Z
  // (dbed7311 -> c1f26410). Alarming on a fault the machinery already fixed by
  // itself is how a board teaches its reader to skip it.
  const m = manifest();
  const transient = plantHistory(healthy(m), m, [
    { at: "2026-08-31T02:39:26Z", status: "refused", class: "input-bad", published: 0, left_drafted: 57 },
    { at: "2026-08-31T02:59:28Z", status: "published", class: null, published: 8, left_drafted: 49 },
  ]);
  assert.equal(rowFor(rollcall(m, transient, T0), SETTLEMENT).verdict, OK);
});

test("FALSIFIER (j): three crossings publishing nothing WHILE the backlog grows is starvation", () => {
  // "On 2026-08-26 a crossing left 42 marks drafted and reported nothing; a
  // starving crossing printed '0 published, 0 unpublished' and read as a quiet
  // day for two days." Every one of those receipts was individually honest. The
  // pattern is the finding, and a file overwritten twice a day cannot hold one.
  const m = manifest();
  const starving = plantHistory(healthy(m), m, [
    { at: "2026-08-25T17:45:00Z", status: "quiet", class: null, published: 0, left_drafted: 12 },
    { at: "2026-08-26T05:45:00Z", status: "quiet", class: null, published: 0, left_drafted: 30 },
    { at: "2026-08-26T17:45:00Z", status: "quiet", class: null, published: 0, left_drafted: 42 },
  ]);

  const row = rowFor(rollcall(m, starving, T0), SETTLEMENT);
  assert.equal(row.verdict, ALARM_OUTCOME);
  assert.match(row.reason, /published nothing across its last 3 crossings/);
  assert.match(row.reason, /12 -> 42/, "the alarm must name the backlog it is describing");
});

test("FALSIFIER (j2): three EMPTY crossings with a FLAT backlog is a quiet town, not starvation", () => {
  // The control for (j), and the one that keeps this row usable. Nothing eligible
  // for a day and a half is an ordinary weekend; alarming on it would put a
  // permanent red on the board and end its usefulness inside a week.
  const m = manifest();
  const quiet = plantHistory(healthy(m), m, [
    { at: "2026-08-25T17:45:00Z", status: "quiet", class: null, published: 0, left_drafted: 12 },
    { at: "2026-08-26T05:45:00Z", status: "quiet", class: null, published: 0, left_drafted: 12 },
    { at: "2026-08-26T17:45:00Z", status: "quiet", class: null, published: 0, left_drafted: 12 },
  ]);
  assert.equal(rowFor(rollcall(m, quiet, T0), SETTLEMENT).verdict, OK);
});

test("FALSIFIER (j3): a row that declares an outcome log and has none says so", () => {
  // A row asserting it is judged by its output, with no output to judge, is a row
  // nobody is judging — the same silence as an un-allowanced heartbeat, one layer
  // in. It must not read green.
  const m = manifest();
  const path = historyPathOf(m);
  const empty = mutate(healthy(m), (s) => { s.files[path] = { exists: false }; });

  const row = rowFor(rollcall(m, empty, T0), SETTLEMENT);
  assert.equal(row.verdict, ALARM_OUTCOME);
  assert.match(row.reason, /empty or unreadable/);
});

test("staleness outranks outcome — a rail that did not run is not described by its old output", () => {
  // Ordering, asserted rather than assumed. If a stale row could be relabelled by
  // its own last receipt, a settlement that stopped running two days ago would
  // report on the crossing it managed before it died.
  const m = manifest();
  const row = m.units.find((u) => u.unit === SETTLEMENT);
  const refused = plantHistory(healthy(m), m, [
    { at: "2026-08-27T05:45:00Z", status: "refused", class: "canon-bad", published: 0, left_drafted: 21 },
  ]);
  const alsoStale = mutate(refused, (s) => {
    s.files[row.heartbeat.path].text = JSON.stringify({ at: new Date(T0 - 3 * 24 * 60 * MINUTE).toISOString() });
  });
  assert.equal(rowFor(rollcall(m, alsoStale, T0), SETTLEMENT).verdict, ALARM_STALE);
});

test("the outcome thresholds are MANIFEST DATA — the checker holds no baseline of its own", () => {
  // A baseline compiled into the checker is a number nobody can review beside the
  // reason for it. Widening the window in the manifest must move the judgment.
  const m = manifest();
  const wide = {
    ...m,
    units: m.units.map((u) => (u.unit === SETTLEMENT ? { ...u, outcome: { ...u.outcome, zero_published_runs: 6 } } : u)),
  };
  const starving3 = plantHistory(healthy(m), m, [
    { at: "a", status: "quiet", class: null, published: 0, left_drafted: 12 },
    { at: "b", status: "quiet", class: null, published: 0, left_drafted: 30 },
    { at: "c", status: "quiet", class: null, published: 0, left_drafted: 42 },
  ]);
  assert.equal(rowFor(rollcall(m, starving3, T0), SETTLEMENT).verdict, ALARM_OUTCOME, "at a window of 3 it alarms");
  assert.equal(rowFor(rollcall(wide, starving3, T0), SETTLEMENT).verdict, OK,
    "at a window of 6, three crossings is not yet the pattern");
});

test("FALSIFIER (i4): N crossings where the store was never told is an ALARM, and it names the key", () => {
  // THE FIELD WAS WRITTEN AND NOTHING READ IT (G1 lane 1, the reviewer's note 4).
  // The retire step degrades LOUDLY — a box with no `WORLD2_CLEARING_URL` writes
  // `retired: {ran: false}` into every receipt and publishes canon anyway, which
  // is the right failure. It is also the shape nobody reads: a named absence
  // repeated twice a day forever is indistinguishable from a quiet town unless
  // something counts it. That is the 2026-08-26 starvation lesson one rule up,
  // and this is the same lesson applied to the register instead of the backlog.
  const m = manifest();
  const blind = plantHistory(healthy(m), m, [
    { at: "a", status: "published", class: null, published: 4, left_drafted: 10, retired: null },
    { at: "b", status: "published", class: null, published: 3, left_drafted: 9, retired: null },
    { at: "c", status: "published", class: null, published: 5, left_drafted: 8, retired: null },
  ]);
  const row = rowFor(rollcall(m, blind, T0), SETTLEMENT);
  assert.equal(row.verdict, ALARM_OUTCOME);
  // The operator must be told WHICH key, or the alarm is a puzzle.
  assert.match(row.reason, /WORLD2_CLEARING_URL/);
  assert.match(row.reason, /unpublished/);
});

test("FALSIFIER (i4e): the retire alarm carries its OWN means, never the sibling's install-day excuse", () => {
  // The shared `means` on this row ends with "INSTALL-DAY NOTE: this row is
  // EXPECTED to read ALARM-outcome until the first crossing after deploy writes
  // the log, and it clears itself then." That is true of its two siblings and
  // FALSE of this rule: a missing `retired` key does not match, so this alarm is
  // silent on an old log and has no install day to be excused for. Appending the
  // shared sentence would hand the operator a reason to ignore the one alarm that
  // never needs one — a real finding read as expected noise, which is the exact
  // way a board stops being read.
  const m = manifest();
  const blind = plantHistory(healthy(m), m, [
    { at: "a", status: "published", class: null, published: 4, left_drafted: 10, retired: null },
    { at: "b", status: "published", class: null, published: 3, left_drafted: 9, retired: null },
    { at: "c", status: "published", class: null, published: 5, left_drafted: 8, retired: null },
  ]);
  const reason = rowFor(rollcall(m, blind, T0), SETTLEMENT).reason;
  assert.doesNotMatch(reason, /INSTALL-DAY NOTE/,
    "the retire alarm must not inherit an install-day excuse it does not have");
  // And it must still say what to DO, or it is an alarm with no next step.
  assert.match(reason, /postmark-office\.env|box carry/);
});

test("FALSIFIER (i4b): THE CONTROL — a step that RAN and retired nothing is green", () => {
  // `retired: 0` is the common crossing: the step asked and there was nothing to
  // retire. Alarming on it would fire on nearly every crossing and teach the
  // board to be ignored, which is worse than not having the rule.
  const m = manifest();
  const ranEmpty = plantHistory(healthy(m), m, [
    { at: "a", status: "published", class: null, published: 4, left_drafted: 10, retired: 0 },
    { at: "b", status: "published", class: null, published: 3, left_drafted: 9, retired: 0 },
    { at: "c", status: "published", class: null, published: 5, left_drafted: 8, retired: 0 },
  ]);
  assert.equal(rowFor(rollcall(m, ranEmpty, T0), SETTLEMENT).verdict, OK,
    "a step that ran and found nothing is not a step that never ran");
});

test("FALSIFIER (i4c): a log written BEFORE the field existed never alarms about it", () => {
  // A missing key is not a null. Lines predating the retire step carry no
  // `retired` at all, and an old log must not alarm about a step that did not
  // exist when it was written — which is also why this rule needs no install-day
  // exception, unlike its sibling.
  const m = manifest();
  const old = plantHistory(healthy(m), m, [
    { at: "a", status: "published", class: null, published: 4, left_drafted: 10 },
    { at: "b", status: "published", class: null, published: 3, left_drafted: 9 },
    { at: "c", status: "published", class: null, published: 5, left_drafted: 8 },
  ]);
  assert.equal(rowFor(rollcall(m, old, T0), SETTLEMENT).verdict, OK);
});

test("FALSIFIER (i4d): one blind crossing among two that asked is not the pattern", () => {
  // The window is three for its sibling's reason. A single crossing that could
  // not reach the store — a restart, a moment of contention — is not the
  // register drifting from canon.
  const m = manifest();
  const mixed = plantHistory(healthy(m), m, [
    { at: "a", status: "published", class: null, published: 4, left_drafted: 10, retired: 0 },
    { at: "b", status: "published", class: null, published: 3, left_drafted: 9, retired: null },
    { at: "c", status: "published", class: null, published: 5, left_drafted: 8, retired: 2 },
  ]);
  assert.equal(rowFor(rollcall(m, mixed, T0), SETTLEMENT).verdict, OK);
});

test("FALSIFIER (i3): a refusal that KEEPS COMING BACK is an alarm whatever its class says", () => {
  // The class rule catches the refusal that announces itself terminal. This
  // catches the one that does not and is terminal anyway, and the receipt is the
  // repair that finally cleared it — postmark-world 7f866059, 2026-08-30 22:40,
  // its own message, verbatim:
  //
  //   "operator repair (#1862 class, the S45 rebase residues) … These two were
  //    the sweep's standing 2-error lint refusal (EVERY CROSSING SINCE 08-28
  //    re-drained them, dropped one, tripped on the other)"
  //
  // Six input-bad refusals over three days. Each one individually rerunnable,
  // each rerun composing the same red, because what produced them was upstream
  // of the rerun. Judged on STATUS and not on left_drafted: a refused crossing
  // never reaches the point of having channel counts, so its receipt carries
  // zeros and the starvation rule is structurally blind to it.
  const m = manifest();
  const recurring = plantHistory(healthy(m), m, [
    { at: "2026-08-29T17:45:00Z", status: "refused", class: "input-bad", published: 0, left_drafted: 0 },
    { at: "2026-08-30T05:45:00Z", status: "refused", class: "input-bad", published: 0, left_drafted: 0 },
    { at: "2026-08-30T17:45:00Z", status: "refused", class: "input-bad", published: 0, left_drafted: 0 },
  ]);

  const row = rowFor(rollcall(m, recurring, T0), SETTLEMENT);
  assert.equal(row.verdict, ALARM_OUTCOME);
  assert.match(row.reason, /has not completed a crossing in its last 3 attempts/);
  assert.match(row.reason, /upstream of the rerun/,
    "the alarm does not say why rerunning has stopped being the answer");
});

test("FALSIFIER (i4): a refusal with a SUCCESS between is not a recurrence", () => {
  // The control for (i3), and it is what keeps the row usable. A refusal that a
  // rerun cleared is the ordinary case — the 02:39 refusal and the 02:59:28Z
  // publish that followed it. Alarming on that would put a red on the board
  // every time the machinery fixed itself, which is the opposite of the point.
  const m = manifest();
  const recovered = plantHistory(healthy(m), m, [
    { at: "2026-08-31T02:39:26Z", status: "refused", class: "input-bad", published: 0, left_drafted: 57 },
    { at: "2026-08-31T02:59:28Z", status: "published", class: null, published: 8, left_drafted: 49 },
    { at: "2026-08-31T05:45:00Z", status: "refused", class: "input-bad", published: 0, left_drafted: 0 },
  ]);
  assert.equal(rowFor(rollcall(m, recovered, T0), SETTLEMENT).verdict, OK);
});

test("FALSIFIER (i5): three raced-out crossings count as unsettled too", () => {
  // A race that survives its retries is the other way a crossing ends without
  // completing, and three of them in a row is contention nobody is watching.
  const m = manifest();
  const raced = plantHistory(healthy(m), m, [
    { at: "a", status: "race", class: null, published: 0, left_drafted: 0 },
    { at: "b", status: "race", class: null, published: 0, left_drafted: 0 },
    { at: "c", status: "race", class: null, published: 0, left_drafted: 0 },
  ]);
  const row = rowFor(rollcall(m, raced, T0), SETTLEMENT);
  assert.equal(row.verdict, ALARM_OUTCOME);
  assert.match(row.reason, /race, race, race/);
});

// ── ONE READER OF THE SETTLEMENT LOG (postmark#2979, POS-130) ───────────────
//
// postmark#2974 gave deploy/settlement-history.mjs a `by_hand` field and taught
// the crossing's own 05:45Z escalation to ask its question of SCHEDULED lines
// only, for a reason it states in its own words: a person rescuing the town by
// hand is not the timer being healthy.
//
// This file kept a SECOND copy of that law — its own `UNSETTLED` set and its own
// unfiltered `history.slice(-n)` — so the escalation and the board an operator
// reads at 8am could disagree about the same log. Measured on the code as it
// stood at bcdede7: (o1) and (o3) were SILENT and (o2) ALARMED, which is all
// three of them wrong, and (o2) was wrong by printing the exact sentence (o1)
// should have printed. Both windows now judge `scheduledRuns(history)`.
//
// THE WINDOW IS MANIFEST DATA, so each fixture asserts the threshold it was
// built against before it asserts any verdict. A falsifier that quietly stops
// covering its own case when a number moves is worse than no falsifier.
//
// THE CAN-FAIL FLIP: in `judgeOutcome`, restore `const UNSETTLED = new Set([
// "refused", "starving", "race"])` and slice `history` in place of
// `scheduledRuns(history)` in both windows. (o1) and (o3) go green-to-red;
// (o2) reddens the other way, which is why all three are here.

const outcomeOf = (m, unit = SETTLEMENT) => m.units.find((u) => u.unit === unit).outcome;

test("FALSIFIER (o1): a by-hand publication between refusals does not break the timer's streak", () => {
  // THE READING #2786 EXISTS TO FORBID. Before this, a person publishing by hand
  // between two refusals broke the run and silenced the board — the operator
  // rescuing the town by hand read back as the town being well.
  const m = manifest();
  assert.equal(Number(outcomeOf(m).unsettled_runs), 3, "this fixture is built for a window of 3");

  const rescued = plantHistory(healthy(m), m, [
    { at: "2026-08-29T17:45:00Z", status: "refused", class: "input-bad", published: 0, left_drafted: 40 },
    { at: "2026-08-30T05:45:00Z", status: "refused", class: "input-bad", published: 0, left_drafted: 44 },
    { at: "2026-08-30T11:02:00Z", status: "published", class: null, published: 9, left_drafted: 35, by_hand: true },
    { at: "2026-08-30T17:45:00Z", status: "refused", class: "input-bad", published: 0, left_drafted: 39 },
  ]);

  const row = rowFor(rollcall(m, rescued, T0), SETTLEMENT);
  assert.equal(row.verdict, ALARM_OUTCOME);
  // The statuses inside the sentence are the discriminator: three refusals, not
  // the last three LINES, which would read "refused, published, refused".
  assert.match(row.reason, /has not completed a crossing in its last 3 attempts — refused, refused, refused/);
  assert.match(row.reason, /upstream of the rerun/);
});

test("FALSIFIER (o2): a run of BY-HAND refusals is not the timer refusing, and the board stays quiet", () => {
  // The control for (o1), and the half that can only be got wrong in the other
  // direction: a week of by-hand probes ("nothing to publish") must not read as
  // a week of refusals. The schedule is not stuck; nobody asked it anything.
  //
  // left_drafted is flat on purpose. It keeps the starvation rule out of the
  // answer, so a green here is the unsettled window being silent rather than a
  // second rule happening not to fire.
  const m = manifest();
  assert.equal(Number(outcomeOf(m).unsettled_runs), 3, "this fixture is built for a window of 3");

  const probes = plantHistory(healthy(m), m, [
    { at: "2026-08-29T14:05:02Z", status: "refused", class: "input-bad", published: 0, left_drafted: 0, by_hand: true },
    { at: "2026-08-30T14:05:02Z", status: "refused", class: "input-bad", published: 0, left_drafted: 0, by_hand: true },
    { at: "2026-08-31T14:05:02Z", status: "refused", class: "input-bad", published: 0, left_drafted: 0, by_hand: true },
  ]);

  assert.equal(rowFor(rollcall(m, probes, T0), SETTLEMENT).verdict, OK);
});

test("FALSIFIER (o3): a by-hand publication inside an otherwise-empty window does not mask a starving timer", () => {
  // The same gap from the other side. A by-hand publication is still a published
  // crossing, so one of them anywhere in the last three lines made `noneOut`
  // false and the starvation alarm went quiet — while the timer published
  // nothing and left_drafted climbed.
  const m = manifest();
  assert.equal(Number(outcomeOf(m).zero_published_runs), 3, "this fixture is built for a window of 3");

  const masked = plantHistory(healthy(m), m, [
    { at: "2026-08-25T17:45:00Z", status: "quiet", class: null, published: 0, left_drafted: 12 },
    { at: "2026-08-26T11:02:00Z", status: "published", class: null, published: 7, left_drafted: 20, by_hand: true },
    { at: "2026-08-26T17:45:00Z", status: "quiet", class: null, published: 0, left_drafted: 30 },
    { at: "2026-08-27T05:45:00Z", status: "quiet", class: null, published: 0, left_drafted: 42 },
  ]);

  const row = rowFor(rollcall(m, masked, T0), SETTLEMENT);
  assert.equal(row.verdict, ALARM_OUTCOME);
  // 12 -> 42 are the SCHEDULED window's own ends. The unfiltered last three
  // lines would read 20 -> 42, so this string is what proves which was judged.
  assert.match(row.reason, /published nothing across its last 3 crossings while left_drafted grew 12 -> 42/);
});

test("a row judged by its output must declare unsettled_runs — the manifest refuses one that does not", () => {
  // Without it a refusal that returns twice a day forever reads green, which is
  // the exact silence this whole block exists to end.
  const dir = mkdtempSync(join(tmpdir(), "rollcall-outcome-"));
  const m = manifest();
  const bad = {
    ...m,
    units: m.units.map((u) => (u.unit === SETTLEMENT
      ? { ...u, outcome: { history_path: "/x", alarm_on_classes: [], zero_published_runs: 3, means: "m", why: "w" } }
      : u)),
  };
  const p = join(dir, "manifest.json");
  writeFileSync(p, JSON.stringify(bad));
  assert.throws(() => loadManifest(p), /no unsettled_runs/);
});

// ── §2b WHO OWNS THE FILES A SERVICE HAS TO WRITE (v1 #2b, 2026-08-30) ──────
//
// On 2026-08-28 a `sudo git` touched the settlement clone and left root-owned
// files inside it. The lane runs as meepo. Root-owned refs, objects and a
// root-owned credential store then failed LATER and SEPARATELY — a two-hour pen
// lockout one day, a refused 05:45Z crossing the next — with nothing on the box
// tying either back to the act that caused them, because nothing on the box
// could see the ownership of a working file at all.

const CUSTODY_ID = "settlement-clone-git";

const custodyRowFor = (result) => rowFor(result, `custody:${CUSTODY_ID}`);

test("FALSIFIER (k): a root-owned path inside the settlement clone is ALARM-custody, and it NAMES the path", () => {
  const m = manifest();
  const wounded = mutate(healthy(m), (s) => {
    s.custody[CUSTODY_ID].offenders = [
      { path: "/srv/postmark-office/settlement-clone/.git/refs/heads/main", uid: 0 },
      { path: "/srv/postmark-office/settlement-clone/.git/objects/pack/pack-abc.idx", uid: 0 },
    ];
  });

  const row = custodyRowFor(rollcall(m, wounded, T0));
  assert.equal(row.verdict, ALARM_CUSTODY);
  assert.match(row.reason, /refs\/heads\/main \(uid 0\)/,
    "an alarm that does not name the offending path leaves the operator running find(1) at 8am");
  assert.match(row.reason, /chown -R meepo/, "the repair here is chown and not systemctl — the row must say which");
  assert.equal(rollcall(m, wounded, T0).exitCode, 1);
});

test("FALSIFIER (k2): a scan that hit its bound is NOT a clean scan", () => {
  // Reporting an unfinished scan as clean is the failure this whole file exists
  // to end, committed by the checker itself.
  const m = manifest();
  const capped = mutate(healthy(m), (s) => { s.custody[CUSTODY_ID].truncated = true; });
  const row = custodyRowFor(rollcall(m, capped, T0));
  assert.equal(row.verdict, ALARM_CUSTODY);
  assert.match(row.reason, /did not finish/);
});

test("FALSIFIER (k3): a must_be_owned_by that does not resolve on the box cannot report clean", () => {
  // If the user is gone or misspelled there is no uid to compare against, and a
  // comparison that cannot be made must never come back as agreement.
  const m = manifest();
  const noUser = mutate(healthy(m), (s) => { s.custody[CUSTODY_ID].expect_uid = null; });
  const row = custodyRowFor(rollcall(m, noUser, T0));
  assert.equal(row.verdict, ALARM_CUSTODY);
  assert.match(row.reason, /does not resolve to a uid/);
});

test("FALSIFIER (k4): a custody path that is not on the box at all is an alarm, never silence", () => {
  const m = manifest();
  const gone = mutate(healthy(m), (s) => {
    s.custody[CUSTODY_ID] = { exists: false, path: "/srv/postmark-office/settlement-clone/.git" };
  });
  const row = custodyRowFor(rollcall(m, gone, T0));
  assert.equal(row.verdict, ALARM_CUSTODY);
  assert.match(row.reason, /is not on the box at all/);
});

test("a custody row must say what breaks when custody slips — the manifest refuses one that cannot", () => {
  // The same discipline as activation_owner on a unit row: a row that cannot say
  // why it matters is a row nobody will act on when it reddens.
  const dir = mkdtempSync(join(tmpdir(), "rollcall-custody-"));
  const m = manifest();
  const bad = { ...m, custody: [{ id: "x", path: "/tmp/x", must_be_owned_by: "meepo" }] };
  const p = join(dir, "manifest.json");
  writeFileSync(p, JSON.stringify(bad));
  assert.throws(() => loadManifest(p), /does not say what breaks when custody slips/);
});

test("the custody scan walks a real tree and finds the one file somebody else owns", () => {
  // The collector's own half, over injected fs calls. The judgment above is only
  // as good as the scan feeding it, and a scan that silently skipped
  // subdirectories would report a wounded clone clean forever.
  // Keys built with join() so the fixture speaks the host's own separator — the
  // scan walks with join(), and a fixture keyed on "/" would simply miss on
  // Windows and report a three-entry scan as complete.
  const G = join("dot-git");
  const REFS = join(G, "refs");
  const HEADS = join(REFS, "heads");
  const MAIN = join(HEADS, "main");
  const CONFIG = join(G, "config");

  const tree = { [G]: ["refs", "config"], [REFS]: ["heads"], [HEADS]: ["main"] };
  const owner = { [G]: 1001, [CONFIG]: 1001, [REFS]: 1001, [HEADS]: 1001, [MAIN]: 0 };
  const lstat = (p) => {
    if (!(p in owner)) throw new Error(`the scan walked to a path the fixture does not have: ${p}`);
    return { uid: owner[p], isDirectory: () => Array.isArray(tree[p]) };
  };
  const readdir = (p) => tree[p] ?? [];

  const r = scanCustody(G, 1001, { readdir, lstat });
  assert.equal(r.scanned, 5, "the scan did not reach every entry — a missed subdirectory is a permanent blind spot");
  assert.equal(r.truncated, false);
  assert.deepEqual(r.offenders.map((o) => o.path), [MAIN]);

  // And the bound is real: the same tree under a cap of 2 reports truncated.
  const capped = scanCustody(G, 1001, { readdir, lstat, cap: 2 });
  assert.equal(capped.truncated, true);
});

// ── §2b reaches the DEV office's clones, and the dev freshen fails loud ─────
// (POS-192, 2026-09-22)
//
// Found by hand while wiring dev to the store: postmark-dev-freshen (runs as
// meepo) had been failing its `git reset` on 1,918 root-owned files in
// /srv/postmark-office-dev/world-clone and town-clone — Permission denied — for
// an unknown time, and no row said so. Two holes, one each side:
//   · the custody rows covered prod's clones and not dev's, so the foreign
//     owner was invisible;
//   · the freshen printed "stood back" past the errors and exited 0, so the
//     timer's service row read success. Its `set -euo pipefail` sat in the
//     OUTER shell; the work runs in the `bash -c` child that flock starts, and a
//     child shell does not inherit -e.

const DEV_CUSTODY = {
  "dev-world-clone": "/srv/postmark-office-dev/world-clone",
  "dev-town-clone": "/srv/postmark-office-dev/town-clone",
};

test("the dev office's two clones carry custody rows in the prod rows' own grammar, owned by meepo", () => {
  const m = manifest();
  const prod = m.custody.find((r) => r.id === CUSTODY_ID);
  assert.ok(prod, "the prod settlement-clone row this test compares against is gone");
  for (const [id, path] of Object.entries(DEV_CUSTODY)) {
    const row = m.custody.find((r) => r.id === id);
    assert.ok(row, `no custody row ${id} — the dev clones are unwatched again`);
    assert.equal(row.path, path);
    assert.equal(row.must_be_owned_by, "meepo", "postmark-dev-freshen.service runs as User=meepo");
    // Same field set as the prod row: a dev row missing `repair` or `label`
    // would pass loadManifest and still read worse on the board at 8am.
    assert.deepEqual(Object.keys(row).sort(), Object.keys(prod).sort());
    assert.match(row.why, /1,918/, "the why must name the instance it exists for");
    assert.match(row.repair, new RegExp(`chown -R meepo:meepo ${path}`));
  }
});

test("FALSIFIER (k5): a root-owned file in either dev clone is ALARM-custody, NAMES the path, and exits 1", () => {
  const m = manifest();
  // The control first: both dev rows green on the planted healthy state, so
  // the red below is the mutation's doing and not the fixture's.
  const clean = rollcall(m, healthy(m), T0);
  for (const id of Object.keys(DEV_CUSTODY)) assert.equal(rowFor(clean, `custody:${id}`).verdict, OK);

  for (const [id, path] of Object.entries(DEV_CUSTODY)) {
    const planted = `${path}/records/letters/2026-09-22.json`;
    const wounded = mutate(healthy(m), (s) => { s.custody[id].offenders = [{ path: planted, uid: 0 }]; });
    const result = rollcall(m, wounded, T0);
    const row = rowFor(result, `custody:${id}`);
    assert.equal(row.verdict, ALARM_CUSTODY);
    assert.ok(row.reason.includes(`${planted} (uid 0)`), "the alarm must name the foreign-owned path");
    assert.match(row.reason, /chown -R meepo/);
    assert.equal(result.exitCode, 1);
  }
});

// The freshen itself, run for real under bash with two stubs on the road: a
// `flock` that drops its lock arguments and execs the command, and a `git` that
// logs every call and — when FRESHEN_FAIL names a verb — refuses that verb the
// way the box did (Permission denied, exit 128). The script is the shipped
// file, unedited; POSTMARK_DEV_ROOT / POSTMARK_DEV_FLOCK are the two seams it
// declares, and the unit sets neither.
//
// THE CAN-FAIL FLIP: delete the `  set -euo pipefail` line INSIDE the bash -c
// body of deploy/postmark-dev-freshen.sh. The two refusal tests below go red —
// the script exits 0 and prints "stood back" past a refused reset, which is the
// 2026-09-22 instance exactly.
const FRESHEN = join(HERE, "..", "deploy", "postmark-dev-freshen.sh");
const posix = (p) => p.replaceAll("\\", "/");
const bashProbe = spawnSync("bash", ["-c", "exit 0"], { encoding: "utf8" });
const noBash = bashProbe.status === 0 ? false : "no bash on this host — the freshen is a bash script and cannot be run without one";

function runFreshen(failVerb) {
  const dir = mkdtempSync(join(tmpdir(), "pos192-freshen-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const log = join(dir, "git.log");
  writeFileSync(join(bin, "git"), [
    "#!/usr/bin/env bash",
    'echo "$*" >> "$FRESHEN_LOG"',
    'if [ -n "${FRESHEN_FAIL:-}" ] && [[ " $* " == *" $FRESHEN_FAIL "* ]]; then',
    "  echo \"error: unable to unlink old 'records/x.json': Permission denied\" >&2",
    "  exit 128",
    "fi",
    "exit 0",
    "",
  ].join("\n"), { mode: 0o755 });
  writeFileSync(join(bin, "flock"), [
    "#!/usr/bin/env bash",
    "# drop -x, -w, 120 and the lock file; run the command",
    'shift 4; exec "$@"',
    "",
  ].join("\n"), { mode: 0o755 });
  writeFileSync(log, "");
  // Windows keeps PATH under whatever case it was born with; write the one key.
  const env = { ...process.env };
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  env[pathKey] = `${bin}${delimiter}${env[pathKey] ?? ""}`;
  Object.assign(env, {
    FRESHEN_LOG: posix(log),
    POSTMARK_DEV_ROOT: "/srv/postmark-office-dev",
    POSTMARK_DEV_FLOCK: posix(join(bin, "flock")),
  });
  if (failVerb) env.FRESHEN_FAIL = failVerb; else delete env.FRESHEN_FAIL;
  const r = spawnSync("bash", [posix(FRESHEN)], { encoding: "utf8", env });
  const calls = readFileSync(log, "utf8").split("\n").filter(Boolean);
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, calls };
}

const STOOD_BACK = /dev clones stood back on sandbox\/seed/;

test("the dev freshen, every step succeeding: exit 0, the stand-back line, all seven git calls in order", { skip: noBash }, () => {
  const r = runFreshen(null);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, STOOD_BACK);
  assert.deepEqual(r.calls.map((c) => c.split(" ").slice(2, 4).join(" ")), [
    "fetch -q", "switch -q", "reset -q",
    "fetch -q", "switch -q", "reset -q",
    "fetch -q",
  ]);
  assert.ok(r.calls[2].startsWith("-C /srv/postmark-office-dev/world-clone reset"));
  assert.ok(r.calls[5].startsWith("-C /srv/postmark-office-dev/town-clone reset"));
});

test("FALSIFIER (freshen): a refused `git reset` exits nonzero with git's code and prints NO stand-back line", { skip: noBash }, () => {
  const r = runFreshen("reset");
  assert.equal(r.status, 128, "the failing git's own exit code must be the unit's exit code");
  assert.doesNotMatch(r.stdout, STOOD_BACK, "the success line printed past a refused reset — the 2026-09-22 instance");
  assert.match(r.stderr, /Permission denied/);
  // It stopped AT the refusal: world-clone's reset was the last call made.
  assert.ok(r.calls.at(-1).startsWith("-C /srv/postmark-office-dev/world-clone reset"), r.calls.join(" | "));
});

test("FALSIFIER (freshen): a refused draft-ref fetch, the LAST step, still exits nonzero with no stand-back line", { skip: noBash }, () => {
  const r = runFreshen("--prune");
  assert.equal(r.status, 128);
  assert.doesNotMatch(r.stdout, STOOD_BACK);
  assert.equal(r.calls.length, 7, "every step before the last one must have run");
});

// ── the list that must be empty (postmark#2594, ruled 2026-09-08) ───────────
//
// `falsifier-canon-locks.mjs` appends one line per crossing naming every locked
// claim the world carries no file for. These four are the rule's whole failure
// space: it must fire on a name, stay silent on an empty list, refuse to be
// silenced by a writer that stops emitting the field, and judge the LATEST
// reading rather than a trend.
//
// THE CAN-FAIL FLIP: in `judgeOutcome`, change `.filter((r) => r.items.length)`
// to `.filter(() => false)` — the check then reads every list as empty. Tests
// "fires" and "judges the latest line" red; "stays silent" and the manifest test
// stay green, which is what makes them controls.

// THE WATCHED FIELDS COME FROM THE SHIPPED ROW; only the SENTENCES are the
// test's own. A hand-written copy of `alarm_on_nonempty` drifted the moment the
// manifest gained `escrow_unbacked`, and the four-row test below passed its first
// three rows against a fixture that was no longer the town's — a control built
// from a copy is a control of the copy. The marker strings stay hand-written so
// an assertion can tell WHICH sentence printed.
const SHIPPED_OUTCOME = manifest().units.find((u) => u.unit === "postmark-world2-notary.timer").outcome;
const LIST_ROW = Object.freeze({
  unit: "postmark-world2-notary.timer",
  outcome: {
    ...SHIPPED_OUTCOME,
    history_path: "/state/canon-locks.jsonl",
    means: "SHARED-MEANS.",
    list_means: "LIST-MEANS.",
    unchecked_means: "UNCHECKED-MEANS.",
  },
});
const logOf = (...lines) => ({ files: { "/state/canon-locks.jsonl": { exists: true, text: lines.map((l) => JSON.stringify(l)).join("\n") + "\n" } } });

test("a non-empty canon_absent list alarms, and the alarm names the slug", () => {
  const said = judgeOutcome(LIST_ROW, logOf(
    { at: "2026-09-08T17:46:00Z", canon_absent: ["lupi/the-drift-room"], unmaterialized: [], escrow_unbacked: [], escrow_checked: true }));
  assert.ok(said, "a locked claim canon has no file for must not read green");
  assert.match(said, /lupi\/the-drift-room/);
  assert.match(said, /LIST-MEANS\./);
  assert.doesNotMatch(said, /SHARED-MEANS\./,
    "the shared means ends with an install-day excuse, and a line naming a slug is never install-day noise");
});

test("an empty list is silent — most crossings are, and a board that cries every morning is not read", () => {
  assert.equal(judgeOutcome(LIST_ROW, logOf(
    { at: "2026-09-08T05:46:00Z", canon_absent: [], unmaterialized: [], escrow_unbacked: [], escrow_checked: true })), null);
});

test("the LATEST line rules: a clean read after a red one clears, and a red after a clean one fires", () => {
  const clean = { at: "a", canon_absent: [], unmaterialized: [], escrow_unbacked: [], escrow_checked: true };
  const red = { at: "b", canon_absent: ["darko/the-second-foundation-stone"], unmaterialized: [], escrow_unbacked: [], escrow_checked: true };
  assert.equal(judgeOutcome(LIST_ROW, logOf(red, clean)), null, "a disagreement the town has since settled is not still true");
  assert.ok(judgeOutcome(LIST_ROW, logOf(clean, red)), "the newest reading is the one that is still true");
});

test("a latest line carrying none of the named fields is itself the alarm, not silence", () => {
  // Deliberately NOT the `retired` rule's silent-on-a-missing-key shape: that
  // discipline is right for a field a rail grew into, and wrong here, because
  // silence would let a writer that stops emitting the list switch off its own
  // alarm.
  const said = judgeOutcome(LIST_ROW, logOf({ at: "c", status: "ok" }));
  assert.ok(said);
  assert.match(said, /carries none of them/);
  assert.match(said, /LIST-MEANS\./);
});

test("the shipped manifest's NOTARY row declares the list alarm, and an empty declaration is refused", () => {
  // THE NOTARY, NOT THE CLEARING, and the move is the reviewer's blocker made
  // structural: the crossing's settlement pushes minutes AFTER the candle
  // clears, so a canon read on the clearing rail asks a checkout that cannot yet
  // carry the marks the crossing just locked. At 03:20 the push is nine hours
  // old. If this assertion ever moves back to the clearing row, the read has
  // been put back in front of the push.
  const row = manifest().units.find((u) => u.unit === "postmark-world2-notary.timer");
  assert.equal(manifest().units.find((u) => u.unit === "postmark-world2-clearing.timer").outcome, undefined,
    "the clearing row must NOT carry this alarm — it would judge a read taken before the push");
  assert.deepEqual(row.outcome.alarm_on_nonempty, ["canon_absent", "unmaterialized", "escrow_unbacked"]);
  // …and the unjudgeable count is a COUNT, declared, and in no alarm list
  // (postmark#2935): if it ever moves into `alarm_on_nonempty`, 227 marks
  // locked before the projection existed alarm every morning again.
  assert.deepEqual(row.outcome.report_counts, ["escrow_unjudgeable"]);
  assert.ok(row.outcome.count_means, "a count with no sentence is a bare number");
  assert.match(row.outcome.history_path, /canon-locks\.jsonl$/);
  // A list-alarm that names no field would pass every other assertion in
  // loadManifest and watch nothing forever.
  const dir = mkdtempSync(join(tmpdir(), "rollcall-manifest-"));
  const bad = join(dir, "m.json");
  const m = manifest();
  m.units.find((u) => u.unit === "postmark-world2-notary.timer").outcome.alarm_on_nonempty = [];
  writeFileSync(bad, JSON.stringify(m));
  assert.throws(() => loadManifest(bad), /alarm_on_nonempty that names no field/);
});

// ── ESCROW-CLEAN IS NOT ESCROW-NEVER-CHECKED (the reviewer's repair 2) ──────
//
// This is the reviewer's own four-row table, driven through the judge. Rows two
// and three used to be the SAME VERDICT FOR OPPOSITE FACTS, and it was masked
// only because the canon half still carried a slug: the moment that settled, the
// row would have gone green while the escrow gate — the lane's centre and the G1
// blocker — had never once been checked.
//
// THE CAN-FAIL FLIP: delete the `alarm_on_false` block in `judgeOutcome`. Row 2
// goes back to OK and this test reds; rows 1, 3 and 4 stay as they are, which is
// what makes them controls.

// ── THE COUNT THAT IS NOT AN ALARM (postmark#2935; 2026-09-18) ──────────────
//
// The notary's escrow read judges each commons mark at the town sha of the
// window that locked it; the projection holds no rows for any window before
// 181, so 227 marks locked at 150–179 read ESCROW-ABSENT every morning for
// eight nights, and the true unbacked count under them was zero. Those marks
// are UNJUDGEABLE, not ✦0: the read writes `escrow_unjudgeable: <n>` on the
// line, the row declares it under `report_counts`, and the board PRINTS it
// beside the verdict — on a green tick and on an alarm alike — and never
// alarms on it.
//
// THE CAN-FAIL FLIP: in `classifyRow`, drop `${tail}` from the OK reason. The
// "prints beside a green tick" test reds; the alarm test and the refusals stay
// green.
const COUNT_ROW = Object.freeze({
  ...LIST_ROW,
  outcome: { ...LIST_ROW.outcome, report_counts: ["escrow_unjudgeable"], count_means: "COUNT-MEANS." },
});
const countLine = (o) => ({ at: "2026-09-18T07:22:00Z", canon_absent: [], unmaterialized: [], escrow_unbacked: [], escrow_checked: true, escrow_unjudgeable: 227, escrow_oldest_projected: "9e1cd85eacae397af4fcc5ac86c2d4ad91e77349", ...o });

test("227 escrow_unjudgeable is a COUNT on the line, not a verdict — judgeOutcome stays null", () => {
  assert.equal(judgeOutcome(COUNT_ROW, logOf(countLine({}))), null, "the count must not alarm — that is the whole of the repair");
  const said = outcomeCounts(COUNT_ROW, logOf(countLine({})));
  assert.match(said, /^227 escrow_unjudgeable — COUNT-MEANS\.$/);
});

test("the count prints beside a GREEN tick, on the row's own reason", () => {
  const m = manifest();
  const notary = m.units.find((u) => u.unit === "postmark-world2-notary.timer");
  // The planted healthy line carries the count as 0; rewrite the LATEST line to
  // prod's 227 and leave everything else healthy.
  const snap = mutate(healthy(m), (s) => {
    const f = s.files[notary.outcome.history_path];
    const lines = f.text.trim().split("\n");
    lines[lines.length - 1] = JSON.stringify({ ...JSON.parse(lines[lines.length - 1]), escrow_unjudgeable: 227 });
    f.text = lines.join("\n") + "\n";
  });
  const row = rowFor(rollcall(m, snap, T0), "postmark-world2-notary.timer");
  assert.equal(row.verdict, OK, "a count is not a verdict");
  assert.match(row.reason, /ticked .* · 227 escrow_unjudgeable — /);
});

test("the count rides beside an ALARM too — the finding first, the count after it", () => {
  const snap = logOf(countLine({ escrow_unbacked: ["someone/a-judgeable-zero"] }));
  const alarm = judgeOutcome(COUNT_ROW, snap);
  assert.ok(alarm && /escrow_unbacked/.test(alarm), "a judgeable zero still alarms exactly as before");
  assert.match(outcomeCounts(COUNT_ROW, snap), /^227 escrow_unjudgeable — COUNT-MEANS\.$/);
});

test("a count the latest line does not carry is said in words — and is still not an alarm", () => {
  const snap = logOf({ at: "old", canon_absent: [], unmaterialized: [], escrow_unbacked: [], escrow_checked: true });
  assert.equal(judgeOutcome(COUNT_ROW, snap), null);
  assert.match(outcomeCounts(COUNT_ROW, snap), /escrow_unjudgeable not counted on the latest line — COUNT-MEANS\./);
  // `null` is the read's own word for "the projection was not checked, so
  // nothing was counted" — not zero, and said the same way.
  assert.match(outcomeCounts(COUNT_ROW, logOf(countLine({ escrow_unjudgeable: null, escrow_checked: false }))), /not counted on the latest line/);
});

test("a row declaring no counts prints no count line, and an empty log leaves it to the empty-log alarm", () => {
  // LIST_ROW spreads the SHIPPED outcome, which now declares the count — so a
  // row with none has to be built by taking it away, not assumed.
  const { report_counts, count_means, ...rest } = LIST_ROW.outcome;
  assert.ok(report_counts, "the shipped row declares it; this test removes it");
  assert.equal(outcomeCounts({ ...LIST_ROW, outcome: rest }, logOf(countLine({}))), null);
  assert.equal(outcomeCounts(COUNT_ROW, { files: {} }), null);
});

test("the manifest refuses a count that names no field, has no sentence, or is ALSO an alarm", () => {
  const dir = mkdtempSync(join(tmpdir(), "rollcall-manifest-"));
  const bad = join(dir, "m.json");
  const notaryOf = (m) => m.units.find((u) => u.unit === "postmark-world2-notary.timer").outcome;
  let m = manifest(); notaryOf(m).report_counts = [];
  writeFileSync(bad, JSON.stringify(m));
  assert.throws(() => loadManifest(bad), /report_counts that names no field/);
  m = manifest(); delete notaryOf(m).count_means;
  writeFileSync(bad, JSON.stringify(m));
  assert.throws(() => loadManifest(bad), /report_counts with no count_means/);
  m = manifest(); notaryOf(m).report_counts = ["escrow_unbacked"];
  writeFileSync(bad, JSON.stringify(m));
  assert.throws(() => loadManifest(bad), /in report_counts AND in an alarm list/);
});

const line = (o) => ({ at: "2026-09-09T03:20:00Z", canon_absent: [], unmaterialized: [], escrow_unbacked: [], escrow_checked: true, ...o });
const judge = (o) => judgeOutcome(LIST_ROW, logOf(line(o)));

test("the reviewer's four rows: only ONE of them used to be wrong, and it is row 2", () => {
  const r1 = judge({ canon_absent: ["lupi/the-drift-room"], escrow_checked: false });
  const r2 = judge({ escrow_checked: false });
  const r3 = judge({ escrow_checked: true });
  const r4 = judge({ escrow_unbacked: ["someone/a-commons-mark"], escrow_checked: true });

  assert.ok(r1, "1 · canon carries a slug, escrow unchecked → ALARM (on the canon half — and, since lap 5, on both; the test below)");
  assert.ok(r2, "2 · lists empty but escrow UNCHECKED → ALARM. This is the repair; it read OK before.");
  assert.equal(r3, null, "3 · lists empty and escrow CHECKED → OK, and it must stay OK");
  assert.ok(r4, "4 · an unbacked slug, escrow checked → ALARM");

  assert.notEqual(r2, r3, "rows 2 and 3 are opposite facts and must never be the same verdict again");
  assert.match(r2, /escrow_checked/);
  assert.match(r2, /a question unanswered and not an answer/);
  assert.match(r2, /UNCHECKED-MEANS\./, "its OWN sentence — the list-alarm's would send an operator after a stake that is not the problem");
  assert.doesNotMatch(r2, /LIST-MEANS\./);
});

// ── ON PROD TODAY, BOTH HALVES SPEAK (lap 5 — the lap-4 reviewer's LOW) ─────
//
// `judgeOutcome` returned the FIRST rule's sentence. With `canon_absent`
// non-empty — prod's condition since window 177, `lupi/the-drift-room` — the
// list alarm returned first and `unchecked_means` never reached the board: the
// operator was told about lupi and not told that the escrow half of the read
// has never run. Repair 2 (the four-row test above) covers the day lupi
// settles; this covers the days before it. The board's reason is one string
// that already carries a paragraph of `means`, so two sentences fit, and the
// list sentence stays first — the finding, then the caveat on it.
//
// THE CAN-FAIL FLIP: in `judgeOutcome`, turn the list block's `sentences.push`
// back into a `return`. Row 1 loses `escrow_checked` and this test reds; the
// four-row test above stays green, which is what makes it the control.
test("row 1 — canon carries a slug AND escrow is unchecked — carries BOTH sentences, the finding first", () => {
  const r1 = judge({ canon_absent: ["lupi/the-drift-room"], escrow_checked: false });
  assert.match(r1, /lupi\/the-drift-room/, "the list half names the slug");
  assert.match(r1, /LIST-MEANS\./, "the list half carries its own repair");
  assert.match(r1, /escrow_checked/, "the flag half is on the board too — this is the repair");
  assert.match(r1, /UNCHECKED-MEANS\./, "the flag half names ITS repair (the migration), beside the list's");
  assert.ok(r1.indexOf("lupi/the-drift-room") < r1.indexOf("escrow_checked"), "the finding first, the caveat after");
  // The controls: rows with one fact still carry exactly one sentence.
  const r2 = judge({ escrow_checked: false });
  assert.doesNotMatch(r2, /LIST-MEANS\./, "an empty list earns no list sentence");
  const r4 = judge({ escrow_unbacked: ["someone/a-commons-mark"], escrow_checked: true });
  assert.doesNotMatch(r4, /UNCHECKED-MEANS\./, "a checked flag earns no flag sentence");
});

test("a latest line carrying no flag at all is itself the alarm — the writer cannot switch it off", () => {
  const said = judgeOutcome(LIST_ROW, logOf({ at: "T", canon_absent: [], unmaterialized: [], escrow_unbacked: [] }));
  assert.ok(said);
  assert.match(said, /carries none of them/);
});

test("the shipped NOTARY row declares the flag alarm, and a nameless or voiceless one is refused", () => {
  const row = manifest().units.find((u) => u.unit === "postmark-world2-notary.timer");
  assert.deepEqual(row.outcome.alarm_on_false, ["escrow_checked"]);
  assert.match(row.outcome.unchecked_means, /migration 014/, "it must name the pending cause, or the operator hunts the wrong one");
  assert.match(row.outcome.unchecked_means, /never a stake/);

  const dir = mkdtempSync(join(tmpdir(), "rollcall-flag-"));
  for (const [mutate, want] of [
    [(o) => { o.alarm_on_false = []; }, /alarm_on_false that names no field/],
    [(o) => { delete o.unchecked_means; }, /alarm_on_false with no unchecked_means/],
  ]) {
    const m = manifest();
    mutate(m.units.find((u) => u.unit === "postmark-world2-notary.timer").outcome);
    const bad = join(dir, `m${Math.random()}.json`);
    writeFileSync(bad, JSON.stringify(m));
    assert.throws(() => loadManifest(bad), want);
  }
});

test("the manifest no longer describes the WITHDRAWN lock-time check as live", () => {
  // after-a-repeal-grep-its-citations: the `why` is the paragraph a reviewer
  // reads beside the thresholds, so a false premise there outlives the code.
  const row = manifest().units.find((u) => u.unit === "postmark-world2-notary.timer");
  assert.doesNotMatch(row.outcome.why, /refuses a fourth at the lock step/);
  assert.match(row.outcome.why, /WITHDRAWN/);
});

// ── §2c WHICH TREE EACH UNIT WILL ACTUALLY RUN (2026-09-10, the arm gate) ────
//
// THE LAW THESE ASSERT, quoted from the incident that earned the class and from
// the founder's go on the fix:
//
//     "escrow_projection stayed at ZERO rows after that same timer's clearing,
//      because the candle unit runs clearing-job.mjs from /srv/world2-lab/office
//      — a second office checkout at 7926461 that the release workflow never
//      deploys. … The box roll-call read the candle OK because it reads its tick
//      file. Two trees, one store."
//
//     Keemin, 2026-09-10: "agreed with your instance and class fixes for the arm
//     gate."
//
// THE FLIP THAT MATTERS is not "delete the row and watch it go green" — that
// proves only that a deleted check does not fire. It is the INCIDENT'S OWN
// FLIP: with the tree comparison removed, does the board read OK over a unit
// ticking perfectly on a stale checkout? The last test in this section runs it.

const CANDLE = "postmark-world2-clearing.service";
const CANDLE_ROW = "tree:postmark-world2-clearing.service";

function unitRowStage(m, treeRow) {
  const timer = treeRow.unit.replace(/\.service$/, ".timer");
  const gov = m.units.find((u) => u.unit === treeRow.unit) || m.units.find((u) => u.unit === timer);
  return gov && gov.stage;
}

/** Point one tree row's unit at a different tree, and plant what is there. */
function repoint(base, m, unit, tree, release) {
  return mutate(base, (s) => {
    const row = m.trees.rows.find((r) => r.unit === unit);
    if (row.env_key) s.tree_sources[unit].env[row.env_key] = tree;
    else s.tree_sources[unit].working_directory = tree;
    if (release !== undefined) s.releases[tree] = release;
  });
}

test("FALSIFIER (t): THE INCIDENT — a unit ticking perfectly on a STALE CHECKOUT is ALARM-tree", () => {
  const m = manifest();
  const before = rollcall(m, healthy(m), T0);
  assert.equal(rowFor(before, CANDLE_ROW).verdict, OK, "the control for this falsifier is not green");
  assert.equal(rowFor(before, "postmark-world2-clearing.timer").verdict, OK);

  const snap = repoint(healthy(m), m, CANDLE, LAB_TREE, {
    exists: true, root: LAB_TREE, path: LAB_TREE + "/release.json", sha: LAB_SHA, tag: "release/2026-w36.4",
  });
  const after = rollcall(m, snap, T0);
  const row = rowFor(after, CANDLE_ROW);

  assert.equal(row.verdict, ALARM_TREE);
  // The roll-call's own ALARM line text, quoted.
  assert.match(row.reason, /runs from \/srv\/world2-lab\/office/);
  assert.match(row.reason, /which is NOT the deployed release release\/2026-w37\.9 @ b01b3bad946d at \/srv\/postmark-office/);
  assert.match(row.reason, /The unit ticks and its work runs OLD CODE/);
  assert.equal(after.exitCode, 1, "the roll-call must exit nonzero on ALARM-tree like every other alarm");

  // AND THE POINT OF THE WHOLE SECTION: the candle's OWN row stays green,
  // because the lane really did run, on time, to completion. That is what the
  // board said on 2026-09-10 and it was true.
  assert.equal(rowFor(after, "postmark-world2-clearing.timer").verdict, OK);
  // Exactly one row moved.
  assert.deepEqual(after.rows.filter((r) => isAlarm(r.verdict)).map((r) => r.unit), [CANDLE_ROW]);
});

test("FALSIFIER (t2): THE CONTROL — the same unit pointed BACK AT THE RELEASE goes green again", () => {
  // The rehearsal the brief asks for, run in both directions on one fixture:
  // stale tree -> ALARM-tree, release tree -> OK. A row that only ever reddens
  // is a row that might be reddening for a reason nobody has isolated.
  const m = manifest();
  const stale = repoint(healthy(m), m, CANDLE, LAB_TREE, {
    exists: true, root: LAB_TREE, sha: LAB_SHA, tag: "release/2026-w36.4",
  });
  assert.equal(rowFor(rollcall(m, stale, T0), CANDLE_ROW).verdict, ALARM_TREE);

  const armed = repoint(stale, m, CANDLE, "/srv/postmark-office");
  const row = rowFor(rollcall(m, armed, T0), CANDLE_ROW);
  assert.equal(row.verdict, OK);
  assert.match(row.reason, /the deployed release release\/2026-w37\.9 @ b01b3bad946d/);
  assert.equal(rollcall(m, armed, T0).exitCode, 0, "the board must come back clean once the tree is pinned");
});

test("FALSIFIER (t3): a SECOND tree carrying the SAME release is green — this reddens on drift, not on tidiness", () => {
  const m = manifest();
  const same = repoint(healthy(m), m, CANDLE, "/srv/postmark-office-mirror", {
    exists: true, root: "/srv/postmark-office-mirror", sha: DEPLOYED_SHA, tag: DEPLOYED_TAG,
  });
  const ok = rowFor(rollcall(m, same, T0), CANDLE_ROW);
  assert.equal(ok.verdict, OK);
  assert.match(ok.reason, /a separate tree, carrying the same release/);

  // …and one commit behind is not the same release.
  const behind = repoint(healthy(m), m, CANDLE, "/srv/postmark-office-mirror", {
    exists: true, root: "/srv/postmark-office-mirror", sha: LAB_SHA, tag: "release/2026-w36.4",
  });
  assert.equal(rowFor(rollcall(m, behind, T0), CANDLE_ROW).verdict, ALARM_TREE);
});

test("FALSIFIER (t4): a tree with NO release stamp at all is an alarm that says so", () => {
  const m = manifest();
  const snap = repoint(healthy(m), m, CANDLE, LAB_TREE, undefined);
  const row = rowFor(rollcall(m, snap, T0), CANDLE_ROW);
  assert.equal(row.verdict, ALARM_TREE);
  assert.match(row.reason, /it carries NO release stamp at all — nothing has ever deployed it/);
});

test("FALSIFIER (t5): a symlinked tree is judged by what it RESOLVES to, both ways", () => {
  const m = manifest();
  // The alternative instance fix that was on the table: /srv/world2-lab/office
  // made a symlink to the release. The string differs and the code is identical,
  // so it must be green — a check that reddened here would push the operator to
  // undo a correct repair.
  const linked = mutate(healthy(m), (s) => {
    s.tree_sources[CANDLE].env.WORLD2_OFFICE = LAB_TREE;
    s.tree_realpath[LAB_TREE] = "/srv/postmark-office";
  });
  assert.equal(rowFor(rollcall(m, linked, T0), CANDLE_ROW).verdict, OK);

  // …and the same machinery must not launder a link to somewhere else.
  const elsewhere = mutate(healthy(m), (s) => {
    s.tree_sources[CANDLE].env.WORLD2_OFFICE = LAB_TREE;
    s.tree_realpath[LAB_TREE] = "/srv/postmark-office.old";
  });
  assert.equal(rowFor(rollcall(m, elsewhere, T0), CANDLE_ROW).verdict, ALARM_TREE);
});

test("FALSIFIER (t6): the world2 rows REFUSE TO GUESS — an unset WORLD2_OFFICE is the alarm", () => {
  const m = manifest();
  // The state of the box before Wright's drop-in: nothing sets the key, and the
  // answer then lives in a hand-copied lib this checker cannot read.
  const snap = mutate(healthy(m), (s) => { delete s.tree_sources[CANDLE].env.WORLD2_OFFICE; });
  const row = rowFor(rollcall(m, snap, T0), CANDLE_ROW);
  assert.equal(row.verdict, ALARM_TREE);
  assert.match(row.reason, /nothing in postmark-world2-clearing\.service's environment sets WORLD2_OFFICE/);
  assert.match(row.reason, /office-tree\.conf/, "the alarm must name the drop-in that fixes it");
  assert.match(row.reason, /which is not the same as correct/);
});

test("FALSIFIER (t7): the deployed stamp is the YARDSTICK — an unreadable one alarms rather than passes", () => {
  // acceptance-names-its-yardstick, from the other side: a checker that cannot
  // read the thing it compares against must not report clean.
  const m = manifest();
  const snap = mutate(healthy(m), (s) => { s.releases["/srv/postmark-office"] = { exists: false, unreadable: true }; });
  const result = rollcall(m, snap, T0);
  const row = rowFor(result, CANDLE_ROW);
  assert.equal(row.verdict, ALARM_TREE);
  assert.match(row.reason, /the deployed release stamp at \/srv\/postmark-office\/release\.json is unreadable/);
  // EVERY checkout row, not just this one — the yardstick is shared.
  const checkoutRows = m.trees.rows.filter((r) => r.kind !== "file_copy" && unitRowStage(m, r) !== "parked");
  for (const r of checkoutRows) assert.equal(rowFor(result, "tree:" + r.unit).verdict, ALARM_TREE);
});

// ── the hand-copied ops directory: the same class one layer down ────────────

test("FALSIFIER (t8): an ops script that DIFFERS from the release is ALARM-tree and names the file", () => {
  const m = manifest();
  const copyRow = m.trees.rows.find((r) => r.kind === "file_copy");
  assert.ok(copyRow, "the manifest declares no file_copy row — the ops-script half is not being run at all");
  const id = "tree:" + copyRow.id;
  assert.equal(rowFor(rollcall(m, healthy(m), T0), id).verdict, OK, "the control for this falsifier is not green");

  const drifted = mutate(healthy(m), (s) => { s.file_copies[copyRow.id].differing = ["world2-notary.sh"]; });
  const row = rowFor(rollcall(m, drifted, T0), id);
  assert.equal(row.verdict, ALARM_TREE);
  assert.match(row.reason, /world2-notary\.sh \(differs\)/);
  assert.match(row.reason, /the box is running code no deploy shipped/);

  // A file the box carries and the release does not is the same finding.
  const orphan = mutate(healthy(m), (s) => { s.file_copies[copyRow.id].missing = ["world2-oldlane.sh"]; });
  assert.match(rowFor(rollcall(m, orphan, T0), id).reason, /world2-oldlane\.sh \(not in the release\)/);

  // A comparison that could not finish is not a clean comparison.
  const cut = mutate(healthy(m), (s) => { s.file_copies[copyRow.id].truncated = true; });
  assert.match(rowFor(rollcall(m, cut, T0), id).reason, /did not finish/);

  // …and a directory that is not there at all must not read as nothing to say.
  const gone = mutate(healthy(m), (s) => { s.file_copies[copyRow.id] = { exists: false }; });
  assert.equal(rowFor(rollcall(m, gone, T0), id).verdict, ALARM_TREE);
});

// ── the reverse direction, RULE 4 for trees ─────────────────────────────────

test("FALSIFIER (t9): a live unit that names a tree and has NO tree row is ALARM-tree", () => {
  const m = manifest();
  assert.deepEqual(unrowedTrees(m, healthy(m)), [], "the shipped manifest already leaves a tree unrowed");

  // A unit the manifest rolls-calls, whose service names a tree, and which no
  // tree row mentions — the shape the candle had on 2026-09-10.
  const snap = mutate(healthy(m), (s) => {
    s.tree_sources["postmark-site-refresh.service"].working_directory = "/srv/some-other-checkout";
  });
  const result = rollcall(m, snap, T0);
  const row = rowFor(result, "tree:postmark-site-refresh.service");
  assert.equal(row.verdict, ALARM_TREE);
  assert.match(row.reason, /appears in NO tree row/);
  assert.match(row.reason, /Add its row to deploy\/box-rollcall-manifest\.json § trees/);
  assert.equal(result.exitCode, 1);
});

test("a PARKED rail's tree row is reported and alarms on nothing", () => {
  const m = manifest();
  const parked = m.trees.rows.find((r) => r.kind !== "file_copy" && unitRowStage(m, r) === "parked");
  assert.ok(parked, "no tree row is governed by a parked unit — the PARKED path here is untested");
  // Even pointed at the retired checkout, a rail nobody is running has no tree
  // to be wrong about; ALARM-unparked on the UNIT row is what catches adoption.
  const snap = repoint(healthy(m), m, parked.unit, LAB_TREE, undefined);
  assert.equal(rowFor(rollcall(m, snap, T0), "tree:" + parked.unit).verdict, PARKED);
});

// ── the manifest's own law for §2c ──────────────────────────────────────────

test("the manifest refuses a tree row that cannot say who owns it, what breaks, or why it diverges", () => {
  const dir = mkdtempSync(join(tmpdir(), "rollcall-trees-"));
  const cases = [
    [(t) => { delete t.rows[0].activation_owner; }, /names no activation_owner/],
    [(t) => { delete t.rows[0].why; }, /does not say what breaks/],
    [(t) => { delete t.rows[0].must_be; }, /names no must_be/],
    [(t) => { t.rows[0].must_be = "/srv/somewhere-else"; }, /does not say why/],
    [(t) => { t.rows[0].unit = "postmark-office.timer"; }, /must name the \.service that execs, never the timer/],
    [(t) => { t.rows[0].unit = "postmark-nobody-rolls-this.service"; }, /which no manifest unit row governs/],
    [(t) => { delete t.release_root; }, /names no release_root/],
  ];
  for (const [mutateTrees, want] of cases) {
    const m = manifest();
    mutateTrees(m.trees);
    const bad = join(dir, "m" + Math.random() + ".json");
    writeFileSync(bad, JSON.stringify(m));
    assert.throws(() => loadManifest(bad), want);
  }
});

test("the shipped manifest carries a tree row for every world2 lane, all pinned to the release", () => {
  const m = manifest();
  // `law-ingest` joined on 2026-09-19 (postmark#2893, the law pen's own unit).
  // This list is written by hand while the test's own sentence says EVERY lane,
  // so a new world2 unit that never reaches this line gets a tree row nothing
  // checks — which is how the check stops reading the behaviour it names.
  for (const lane of ["clearing", "notary", "backup", "ingest", "law-ingest"]) {
    const row = m.trees.rows.find((r) => r.unit === "postmark-world2-" + lane + ".service");
    assert.ok(row, "no tree row for the " + lane + " lane");
    assert.equal(row.env_key, "WORLD2_OFFICE");
    assert.equal(row.must_be, "release");
    assert.match(row.require_env, /office-tree\.conf/, "the row must name the drop-in that answers its key");
  }
  assert.equal(m.trees.release_root, "/srv/postmark-office");
});

// ── the collector's own hazards ─────────────────────────────────────────────

test("pickEnv is a WHITELIST — a password in a sibling drop-in never reaches the snapshot", () => {
  // The runbook's rule: "Never run `systemctl show postmark-settlement.service
  // -p Environment`. The sibling drop-in carries WORLD2_CLEARING_URL with its
  // password inside, and `show` prints the merged environment." A collector that
  // stored that string would be the same leak with a file attached, because
  // --dump-snapshot writes a file the runbook copies OFF THE BOX.
  const secret = "postgres://clearing_job:hunter2hunter2@localhost:5432/world2_dev";
  const raw = "WORLD2_CLEARING_URL=" + secret + " SETTLEMENT_SOURCE=store WORLD2_OFFICE=/srv/postmark-office";
  const picked = pickEnv(raw, ["WORLD2_OFFICE"]);
  assert.deepEqual({ ...picked }, { WORLD2_OFFICE: "/srv/postmark-office" });
  assert.doesNotMatch(JSON.stringify(picked), /hunter2/);
  assert.doesNotMatch(JSON.stringify(picked), /WORLD2_CLEARING_URL/);

  // A quoted value with a space must not split into fragments, or a fragment
  // could look like a key and the whitelist would be reading the wrong token.
  const quoted = 'PG_NOTE="a b WORLD2_OFFICE=/tmp/evil" WORLD2_OFFICE=/srv/postmark-office';
  assert.deepEqual({ ...pickEnv(quoted, ["WORLD2_OFFICE"]) }, { WORLD2_OFFICE: "/srv/postmark-office" });
  assert.deepEqual({ ...pickEnv(raw, []) }, {});
});

test("collectTrees reads every manifest unit's tree source and never keeps a value it was not asked for", () => {
  const m = manifest();
  const asked = [];
  const show = (unit, props) => {
    asked.push([unit, props.join(",")]);
    return {
      WorkingDirectory: unit === "postmark-office.service" ? "/srv/postmark-office" : "",
      Environment: "WORLD2_CLEARING_URL=postgres://u:pw@h/db WORLD2_OFFICE=/srv/postmark-office",
    };
  };
  const snap = collectTrees(m, {
    show,
    realpath: (p) => p,
    readRel: (root) => ({ exists: true, root, sha: DEPLOYED_SHA, tag: DEPLOYED_TAG }),
    compare: () => ({ exists: true, scanned: 1, missing: [], differing: [], truncated: false }),
  });
  // One read per distinct SERVICE, and the timer is never asked.
  assert.ok(asked.length > 0);
  for (const [unit, props] of asked) {
    assert.match(unit, /\.service$/, "a timer was asked for a WorkingDirectory it can never have");
    assert.equal(props, "WorkingDirectory,Environment");
  }
  assert.doesNotMatch(JSON.stringify(snap), /pw@h/, "the raw Environment string reached the snapshot");
  assert.equal(snap.tree_sources[CANDLE].env.WORLD2_OFFICE, "/srv/postmark-office");
  assert.equal(rowFor(rollcall(m, { ...healthy(m), ...snap }, T0), CANDLE_ROW).verdict, OK);
});

test("readRelease answers a MISSING stamp as missing rather than as a guess", () => {
  const reads = {
    "/good/release.json": { exists: true, text: JSON.stringify({ tag: DEPLOYED_TAG, sha: DEPLOYED_SHA }) },
    "/torn/release.json": { exists: true, text: "{not json" },
  };
  const read = (p) => reads[p.split("\\").join("/")] ?? { exists: false };
  assert.equal(readRelease("/good", { read }).sha, DEPLOYED_SHA);
  assert.equal(readRelease("/missing", { read }).exists, false);
  assert.equal(readRelease("/torn", { read }).unreadable, true);
});

test("compareFileCopy reads BYTES — a CRLF copy of the same script is not the same script", () => {
  // DEPLOY.md's own warning: "Strip CR after any copy from a Windows checkout
  // and check it stuck; a unit file with a trailing CR in ExecStart fails in a
  // way that reads like a missing file." A text compare would call this pair
  // identical and the box would keep failing for a reason nothing named.
  const lf = Buffer.from("#!/bin/bash\nexec node x.mjs\n");
  const crlf = Buffer.from("#!/bin/bash\r\nexec node x.mjs\r\n");
  const files = { "/box/a.sh": crlf, "/rel/a.sh": lf, "/box/b.sh": lf, "/rel/b.sh": lf, "/box/c.sh": lf };
  const norm = (p) => p.split("\\").join("/");
  const io = {
    readdir: () => ["a.sh", "b.sh", "c.sh", "notes.md"],
    read: (p) => { const f = files[norm(p)]; if (!f) throw new Error("nope"); return f; },
    exists: (p) => norm(p) === "/box" || norm(p) === "/rel" || norm(p) in files,
  };
  const r = compareFileCopy("/box", "/rel", /\.sh$/, io);
  assert.equal(r.scanned, 3, "the match filter let a non-script through, or dropped a script");
  assert.deepEqual(r.differing, ["a.sh"]);
  assert.deepEqual(r.missing, ["c.sh"]);
  assert.equal(r.truncated, false);

  // Bounded, and it says when it hit the bound.
  const many = compareFileCopy("/box", "/rel", /\.sh$/, { ...io, cap: 1 });
  assert.equal(many.truncated, true);
  assert.equal(COPY_SCAN_CAP > 1, true);
});

// ── THE CAN-FAIL FLIP ───────────────────────────────────────────────────────

test("THE FLIP: with the tree comparison removed, the 2026-09-10 board reads CLEAN over a stale candle", () => {
  // The falsifiers above prove the row reddens. This proves the row is WHY —
  // it reconstructs the board as it stood before this lane and asserts that the
  // exact state that cost a crossing came up green, which is the finding the
  // incident is about. A check that could not be shown to have been ABSENT is a
  // check nobody can tell was ever added.
  const m = manifest();
  const stale = repoint(healthy(m), m, CANDLE, LAB_TREE, {
    exists: true, root: LAB_TREE, sha: LAB_SHA, tag: "release/2026-w36.4",
  });

  const withCheck = rollcall(m, stale, T0);
  assert.equal(withCheck.exitCode, 1);
  assert.deepEqual(withCheck.rows.filter((r) => isAlarm(r.verdict)).map((r) => r.unit), [CANDLE_ROW]);

  // Now the board WITHOUT §2c, on the identical snapshot: no tree rows, no
  // reverse check. This is the roll-call as it shipped on 2026-09-09.
  const blind = { ...m, trees: undefined };
  const without = rollcall(blind, stale, T0);
  assert.equal(without.counts.ALARM, 0, "the flip did not reproduce the incident — something else is reddening");
  assert.equal(without.exitCode, 0);
  assert.equal(rowFor(without, "postmark-world2-clearing.timer").verdict, OK);
  assert.match(formatLines(without).at(-1), /^roll-call clean/);
});
