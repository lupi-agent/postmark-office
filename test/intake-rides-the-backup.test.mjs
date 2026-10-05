// intake-rides-the-backup.test.mjs — POS-346. The money intake files that live
// on the box and nowhere else (wallet registrations, the two card rails'
// journals, the USDC watch's state) ride the nightly backup lane.
//
// THE PROGRAM UNDER TEST IS THE LANE'S OWN: § 1c is cut out of
// deploy/world2-backup.sh and run, as test/roles-db-rides-the-backup.test.mjs
// runs § 1b, so a rewrite of the lane can't pass on a copy kept here.
//
//   copied      a present file is copied whole and its bytes are reported
//   absent      a rail that never ran has no file, and that is legal
//   unreadable  a source that exists and can't be copied is NAMED, and the lane
//               reddens at the end, after the dump has shipped
//   it ships    § 4 puts the copies in the repo under one name each, and the
//               receipt (LATEST.json, the state file) carries the statuses
//
//   node --test test/intake-rides-the-backup.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LANE = readFileSync("deploy/world2-backup.sh", "utf8");
const scratch = mkdtempSync(join(tmpdir(), "pos346-"));
after(() => { try { rmSync(scratch, { recursive: true, force: true, maxRetries: 5 }); } catch { /* litter */ } });
const posix = (p) => p.replace(/\\/g, "/");
const bash = spawnSync("bash", ["-c", "exit 0"]).status === 0 ? false : "no bash on this machine";

function section() {
  const m = LANE.match(/\n(# ── 1c · [\s\S]*?)\n# ── 2 · /);
  assert.ok(m, "deploy/world2-backup.sh has no § 1c before § 2: the intake copy moved and this test measures nothing");
  return m[1];
}

function run(sources) {
  const dumps = join(scratch, `dumps-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dumps, { recursive: true });
  const harness = join(scratch, "harness.sh");
  writeFileSync(harness, [
    "set -uo pipefail",
    `DUMPS='${posix(dumps)}'`, "STAMP=T",
    `W2_WALLET_REGISTRY='${posix(sources.wallets)}'`, `W2_STRIPE_INTAKE='${posix(sources.stripe)}'`,
    `W2_PAYPAL_INTAKE='${posix(sources.paypal)}'`, `W2_USDC_STATE='${posix(sources.usdc)}'`,
    section(),
    'echo "STATUS={$INTAKE_STATUS}"', 'echo "UNREAD=$INTAKE_UNREAD"', 'echo "STAGE=$INTAKE_STAGE"',
  ].join("\n"));
  const out = execFileSync("bash", [harness], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return {
    status: JSON.parse(out.match(/^STATUS=(.*)$/m)[1]),
    unread: out.match(/^UNREAD=(.*)$/m)[1].trim(),
    stage: out.match(/^STAGE=(.*)$/m)[1].trim(),
  };
}

test("present files are copied whole, a missing one is absent, an uncopyable one is named", { skip: bash }, () => {
  const wallets = join(scratch, "registrations.jsonl");
  const stripe = join(scratch, "stripe-intake.jsonl");
  const usdcDir = join(scratch, "state.json");          // a DIRECTORY where the file should be: it exists and cp can't copy it
  writeFileSync(wallets, '{"act":"register","handle":"ada","chain":"base","address":"0x' + "1".repeat(40) + '"}\n');
  writeFileSync(stripe, '{"kind":"seen","session":"cs_1"}\n{"kind":"witnessed","session":"cs_1"}\n');
  mkdirSync(usdcDir, { recursive: true });
  const r = run({ wallets, stripe, paypal: join(scratch, "never-ran.jsonl"), usdc: usdcDir });

  assert.equal(r.status.wallets.status, "copied");
  assert.equal(r.status.stripe.status, "copied");
  assert.equal(r.status.paypal.status, "absent", "a rail that never ran has no file, and that is legal");
  assert.equal(r.status.usdc.status, "unreadable");
  assert.match(r.unread, /state\.json/, "the uncopyable source is named, so the lane can redden on it");
  assert.equal(r.status.stripe.bytes, readFileSync(stripe).length);
  const staged = readdirSync(r.stage).sort();
  assert.deepEqual(staged, ["stripe-stripe-intake.jsonl", "wallets-registrations.jsonl"]);
  assert.equal(readFileSync(join(r.stage, "stripe-stripe-intake.jsonl"), "utf8"), readFileSync(stripe, "utf8"), "copied whole, byte for byte");
});

test("the copies ship in the dump's commit, the receipt carries them, and an unreadable one reddens the unit", () => {
  assert.match(LANE, /cp "\$INTAKE_STAGE"\/\* "\$REPO\/intake\/"/, "§ 4 copies the staged intake files into the backup repo");
  assert.match(LANE, /"intake": \{\$INTAKE_STATUS\}/, "LATEST.json carries the intake statuses");
  assert.match(LANE, /"intake":\{%s\}/, "the state file carries them too, for the roll-call row that watches this lane");
  const tail = LANE.slice(LANE.lastIndexOf("# ── 5 · local retention"));
  assert.match(tail, /\[ -z "\$INTAKE_UNREAD" \] \|\| \{[^}]*exit 1; \}/, "an unreadable intake file exits 1, after the push");
  assert.ok(LANE.indexOf('[ -z "$INTAKE_UNREAD" ]') > LANE.indexOf('push -q origin HEAD:main'), "it reddens AFTER the dump has shipped, never instead of it");
});
